/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type * as http from 'http';
import type * as https from 'https';
import { createRequire } from 'module';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname } from '../../../../../../base/common/path.js';
import { isWindows } from '../../../../../../base/common/platform.js';
import { URI } from '../../../../../../base/common/uri.js';
import { aggregateAnthropicSse, anthropicMessageToSse, ANTHROPIC_MESSAGES_PATH, aggregateResponsesSse, responsesMessageToSse, RESPONSES_PATH, summarizeResponsesRequest, deserializeAnthropicContent, serializeAnthropicContent, summarizeAnthropicRequest, type AnthropicContentBlock, type IAnthropicMessage, type IReadableAnthropicRequest } from './capiWireCodec.js';
import { getAncillaryStub } from './capiStubs.js';
import { findPosixOnlyCommands, formatPosixCommandError, getRecordedShellCommand, type IRecordedCommand } from './posixCommandLint.js';
import { formatModelRequestMismatch, modelRequestsMatch, projectModelRequest } from './modelRequestProjection.js';
import { expandShellToolName, normalizeShellToolNameForCapture } from './shellToolNames.js';
import { scrubUserName, USER_NAME_PLACEHOLDER } from './userNameScrub.js';

const nodeRequire = createRequire(import.meta.url);
const httpModule = nodeRequire('http') as typeof http;
const httpsModule = nodeRequire('https') as typeof https;
const zlibModule = nodeRequire('zlib') as typeof import('zlib');
const yamlModule = nodeRequire('js-yaml') as { load(input: string): unknown; dump(obj: unknown, opts?: { lineWidth?: number; noRefs?: boolean; quotingType?: '"' | '\''; forceQuotes?: boolean }): string };

const MODEL_ENDPOINTS = new Set(['/chat/completions', '/responses', '/v1/messages']);
const STORED_RESPONSE_HEADERS = new Set(['content-type']);

const WORKDIR_PLACEHOLDER = '${workdir}';
const HOMEDIR_PLACEHOLDER = '${homedir}';
const COPIED_PLUGIN_DIR_PLACEHOLDER = '${plugin_copy}';
const COPIED_PLUGIN_DIR_RE = /\$\{homedir\}(?:\/|\\{1,2})user-data(?:\/|\\{1,2})agentPlugins(?:\/|\\{1,2})(?<directory>[^\/\\"]+)/g;
const TEMP_DIR_SUFFIX_PLACEHOLDER = '${temp}';
const TEMP_DIR_SUFFIX_RE = /(\$\{workdir\}(?:\/|\\\\)(?:ahp-(?:snapshot|perm-test|plan-test|abort|test|wt-test|subagent-test|subagent-replay|attachment-test|cd-strip-test|coverage-[a-z-]+)-|copilot-(?:cost-report|text-blob)-|read-sdk-simple))[A-Za-z0-9]{6}/g;
const TEMP_WORKSPACE_COMPONENT_PATTERN = '(?:ahp-|copilot-|read-sdk-simple)[A-Za-z0-9._-]*';
const PATH_SEPARATOR_PATTERN = '(?:\\\\\\\\|\\\\|/)';
const UUID_PLACEHOLDER_RE = /\$\{uuid_\d+\}/g;
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_LISTING_DATE_RE = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+(?:\d{2}:\d{2}|\d{4})\b/g;

const USER_PLACEHOLDER = USER_NAME_PLACEHOLDER;
const CAPI_PLACEHOLDER = '${capi}';
const SECRET_PLACEHOLDER = '${redacted}';
const SECRET_FIELD_RE = /("(?:token|session_token)"\s*:\s*)"[^"]*"/g;

const SYSTEM_FIELD_RE = /("instructions"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
const SYSTEM_PROMPT_PLACEHOLDER = '${system}';

const GITHUB_API_PREFIXES = ['/copilot_internal', '/telemetry', '/copilot/mcp_registry'];

export type CapiReplayMode = 'record' | 'replay';

export interface ICapiReplayResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

interface IRecordedExchange {
	readonly method: string;
	readonly path: string;
	readonly requestBody: string;
	readonly response: ICapiReplayResponse;
}

type TurnDialect = 'anthropic' | 'responses';

const DIALECT_ENDPOINT: Readonly<Record<TurnDialect, { readonly method: string; readonly path: string }>> = {
	anthropic: { method: 'POST', path: ANTHROPIC_MESSAGES_PATH },
	responses: { method: 'POST', path: RESPONSES_PATH },
};

interface IStoredAnthropicMessage {
	readonly content: string | AnthropicContentBlock[];
	readonly stopReason: string | null;
}

interface ITurnExchange {
	readonly request: IReadableAnthropicRequest;
	readonly response: IStoredAnthropicMessage;
}

interface IRawFixtureExchange {
	readonly method: string;
	readonly path: string;
	readonly response: ICapiReplayResponse;
}

type IFixtureExchange = ITurnExchange | IRawFixtureExchange;

interface IFixture {
	readonly version: 1;
	readonly dialect?: TurnDialect;
	readonly exchanges: IFixtureExchange[];
}

function isTurnExchange(exchange: IFixtureExchange): exchange is ITurnExchange {
	return (exchange as ITurnExchange).request !== undefined;
}

export interface ICapiReplayProxyOptions {
	readonly fixturePath: string;
	readonly upstreamUrl?: string;
	readonly githubUpstreamUrl?: string;
	readonly capiUpstreamUrl?: string;
	readonly mode?: CapiReplayMode;
	readonly workDir?: string;
	readonly homeDir?: string;
	readonly userName?: string;
	readonly strict?: boolean;
	readonly allowPosixCommands?: boolean;

	readonly allowStaleRecordedRequest?: boolean;
	readonly recordingModelResponse?: ICapiReplayResponse;
}

type IReplayItem =
	| { readonly kind: 'raw'; readonly response: ICapiReplayResponse }
	| { readonly kind: 'turn'; readonly dialect: TurnDialect; readonly message: IAnthropicMessage; readonly request: IReadableAnthropicRequest };

interface IReplayBucket {
	readonly items: IReplayItem[];
	index: number;
}

export class CapiReplayProxy {
	private _server: http.Server | undefined;
	private _url: string | undefined;
	private _stopped = false;

	private readonly _mode: CapiReplayMode;
	private readonly _strict: boolean;
	private readonly _isReplaying: boolean;

	private readonly _replayBuckets = new Map<string, IReplayBucket>();
	private readonly _recorded: IRecordedExchange[] = [];
	private readonly _observedModelRequestBodies: string[] = [];
	private readonly _cacheMisses: string[] = [];
	private readonly _requestMismatches: string[] = [];
	private readonly _replayPlaceholderValues = new Map<string, string>();
	private readonly _replayPluginDirectories = new Set<string>();
	private _modelTurnCount = 0;
	private _workingDirectory: string | undefined;
	private _recordingModelResponse: { readonly response: ICapiReplayResponse; readonly path?: string } | undefined;

	private _fixturePath: string;

	private _allowStaleRecordedRequest: boolean;

	constructor(private readonly _options: ICapiReplayProxyOptions) {
		this._allowStaleRecordedRequest = _options.allowStaleRecordedRequest ?? false;
		this._fixturePath = _options.fixturePath;
		this._workingDirectory = _options.workDir;
		const fixtureExists = existsSync(this._fixturePath);
		this._mode = _options.mode ?? 'replay';
		this._strict = _options.strict ?? true;
		this._recordingModelResponse = _options.recordingModelResponse ? { response: _options.recordingModelResponse } : undefined;

		if (this._mode === 'replay' && !fixtureExists) {
			throw new Error(`[capi-replay] replay mode requires a fixture but none exists at ${this._fixturePath}`);
		}

		this._isReplaying = this._mode === 'replay';
		if (this._isReplaying) {
			this._loadFixture();
		}
	}

	get url(): string {
		if (!this._url) {
			throw new Error('[capi-replay] proxy not started');
		}
		return this._url;
	}

	get isReplaying(): boolean {
		return this._isReplaying;
	}

	async start(): Promise<string> {
		this._server = httpModule.createServer((req, res) => this._handle(req, res));
		return new Promise((resolve, reject) => {
			this._server!.on('error', reject);
			this._server!.listen(0, '127.0.0.1', () => {
				const addr = this._server!.address();
				if (addr && typeof addr === 'object') {
					this._url = `http://127.0.0.1:${addr.port}`;
					resolve(this._url);
				} else {
					reject(new Error('[capi-replay] failed to determine proxy address'));
				}
			});
		});
	}

	async stop(): Promise<void> {
		if (this._stopped) {
			return;
		}
		this._stopped = true;
		await this._closeSocket();

		if (this._isReplaying) {
			this.assertNoReplayMismatches();
			return;
		}

		this._writeFixture();
	}

	resetForReplay(fixturePath: string, allowStaleRecordedRequest = false): void {
		if (!this._isReplaying) {
			throw new Error('[capi-replay] resetForReplay is only valid in replay mode');
		}
		if (!existsSync(fixturePath)) {
			throw new Error(`[capi-replay] replay mode requires a fixture but none exists at ${fixturePath}`);
		}
		this._fixturePath = fixturePath;
		this._allowStaleRecordedRequest = allowStaleRecordedRequest;
		this._workingDirectory = undefined;
		this._replayBuckets.clear();
		this._observedModelRequestBodies.length = 0;
		this._cacheMisses.length = 0;
		this._requestMismatches.length = 0;
		this._replayPlaceholderValues.clear();
		this._replayPluginDirectories.clear();
		this._modelTurnCount = 0;
		this._loadFixture();
	}

	setWorkingDirectory(workingDirectory: string): void {
		this._workingDirectory = workingDirectory;
	}

	setRecordingModelResponse(response: ICapiReplayResponse, path?: string): void {
		if (this._isReplaying) {
			throw new Error('[capi-replay] setRecordingModelResponse is only valid in record mode');
		}
		this._recordingModelResponse = { response, path };
	}

	get observedModelRequestBodies(): readonly string[] {
		return this._observedModelRequestBodies;
	}

	assertNoReplayMismatches(): void {
		const error = this._createReplayError();
		if (error) {
			throw error;
		}
	}

	takeReplayError(): Error | undefined {
		const error = this._createReplayError();
		this._cacheMisses.length = 0;
		this._requestMismatches.length = 0;
		return error;
	}

	private _createReplayError(): Error | undefined {
		if (!this._isReplaying || !this._strict) {
			return undefined;
		}
		const sections: string[] = [];
		if (this._cacheMisses.length > 0) {
			sections.push(`[capi-replay] ${this._cacheMisses.length} cache miss(es):\n${this._cacheMisses.join('\n')}`);
		}
		if (this._requestMismatches.length > 0) {
			sections.push(`[capi-replay] ${this._requestMismatches.length} model request mismatch(es):\n${this._requestMismatches.join('\n')}`);
		}
		const unconsumed = Array.from(this._replayBuckets.entries())
			.flatMap(([key, bucket]) => bucket.index < bucket.items.length ? [`${key}: ${bucket.items.length - bucket.index} response(s)`] : []);
		if (unconsumed.length > 0) {
			sections.push(`[capi-replay] unconsumed recorded responses:\n${unconsumed.join('\n')}`);
		}
		return sections.length > 0 ? new Error(sections.join('\n\n')) : undefined;
	}

	async close(): Promise<void> {
		if (this._stopped) {
			return;
		}
		this._stopped = true;
		await this._closeSocket();
	}

	private async _closeSocket(): Promise<void> {
		const server = this._server;
		this._server = undefined;
		if (server) {
			await new Promise<void>(resolve => {
				server.close(() => resolve());
				server.closeAllConnections?.();
			});
		}
	}


	private _handle(req: http.IncomingMessage, res: http.ServerResponse): void {
		const chunks: Buffer[] = [];
		req.on('data', chunk => chunks.push(chunk));
		req.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');
			if (this._isReplaying) {
				this._replay(req, body, res);
			} else {
				this._record(req, body, res);
			}
		});
		req.on('error', () => this._fail(res, 'request stream error'));
	}

	private _replay(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
		const method = req.method ?? 'GET';
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;

		const stub = getAncillaryStub(method, path, body);
		if (stub) {
			res.writeHead(stub.status, { ...stub.headers });
			res.end(replaceAll(stub.body, CAPI_PLACEHOLDER, this.url));
			return;
		}

		const key = `${method} ${path}`;
		if (MODEL_ENDPOINTS.has(path)) {
			this._observedModelRequestBodies.push(this._normalize(body));
		}
		const bucket = this._replayBuckets.get(key);

		let item: IReplayItem | undefined;
		if (bucket) {
			if (bucket.index < bucket.items.length) {
				item = bucket.items[bucket.index++];
			} else if (!MODEL_ENDPOINTS.has(path)) {
				item = bucket.items[bucket.items.length - 1];
			}
		}

		if (!item) {
			this._cacheMisses.push(`${key} (call #${(bucket?.index ?? 0) + 1}) — no recorded response`);
			this._fail(res, `no recorded response for ${key}`);
			return;
		}

		if (item.kind === 'turn') {
			this._assertRecordedRequest(item.dialect, item.request, body);
			const message = this._expandReplayMessage(item.message);
			const sseBody = item.dialect === 'responses' ? responsesMessageToSse(message) : anthropicMessageToSse(message);
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
			res.end(sseBody);
			return;
		}

		const headers = { ...item.response.headers };
		delete headers['content-length'];
		delete headers['transfer-encoding'];
		res.writeHead(item.response.status, headers);
		res.end(this._expandReplayPlaceholders(item.response.body));
	}

	private _assertRecordedRequest(dialect: TurnDialect, recorded: IReadableAnthropicRequest, body: string): void {
		const turnIndex = this._modelTurnCount++;
		const summarize = dialect === 'responses' ? summarizeResponsesRequest : summarizeAnthropicRequest;
		const normalizedBody = this._normalize(body);
		const observed = summarize(normalizedBody);
		if (!observed) {
			return;
		}
		captureReplayPlaceholderValues(recorded, observed, this._replayPlaceholderValues);
		if (this._allowStaleRecordedRequest) {
			return;
		}
		const normalizedObserved = summarize(this._normalizeReplayPlaceholderValues(normalizedBody));
		if (!normalizedObserved) {
			return;
		}
		const expected = projectModelRequest(recorded);
		const actual = projectModelRequest(normalizedObserved);
		if (!modelRequestsMatch(expected, actual)) {
			this._requestMismatches.push(formatModelRequestMismatch(turnIndex, expected, actual));
		}
	}

	private _normalizeReplayPlaceholderValues(text: string): string {
		let result = text;
		for (const [placeholder, value] of this._replayPlaceholderValues) {
			result = replaceAll(result, value, placeholder);
		}
		return result;
	}

	private _record(req: http.IncomingMessage, body: string, res: http.ServerResponse): void {
		const method = req.method ?? 'GET';
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;
		const stub = getAncillaryStub(method, path, body);
		if (stub) {
			res.writeHead(stub.status, { ...stub.headers });
			res.end(replaceAll(stub.body, CAPI_PLACEHOLDER, this.url));
			return;
		}
		if (MODEL_ENDPOINTS.has(path)) {
			this._observedModelRequestBodies.push(this._normalize(body));
		}
		if (MODEL_ENDPOINTS.has(path) && this._recordingModelResponse && (!this._recordingModelResponse.path || this._recordingModelResponse.path === path)) {
			const response = this._recordingModelResponse.response;
			this._recordingModelResponse = undefined;
			res.writeHead(response.status, response.headers);
			res.end(response.body);
			this._recorded.push({
				method,
				path,
				requestBody: this._normalize(body),
				response: {
					...response,
					headers: filterRecordedResponseHeaders(response.headers),
					body: this._normalize(response.body),
				},
			});
			return;
		}
		const upstreamBase = this._upstreamFor(path);
		const upstream = new URL(req.url ?? '/', upstreamBase);
		const isHttps = upstream.protocol === 'https:';
		const transport = isHttps ? httpsModule : httpModule;

		const forwardHeaders = { ...req.headers };
		forwardHeaders.host = upstream.host;
		delete forwardHeaders['connection'];
		delete forwardHeaders['content-length'];

		const upstreamReq = transport.request(
			{
				hostname: upstream.hostname,
				port: upstream.port || (isHttps ? 443 : 80),
				path: upstream.pathname + upstream.search,
				method,
				headers: forwardHeaders,
			},
			upstreamRes => {
				const respChunks: Buffer[] = [];
				const status = upstreamRes.statusCode ?? 502;
				const headers = flattenHeaders(upstreamRes.headers);
				res.writeHead(status, headers);
				upstreamRes.on('data', chunk => {
					respChunks.push(chunk);
					res.write(chunk);
				});
				upstreamRes.on('end', () => {
					res.end();
					if (getAncillaryStub(method, path, body)) {
						return;
					}
					const decoded = decodeBody(Buffer.concat(respChunks), headers['content-encoding']);
					const storedHeaders = filterRecordedResponseHeaders(headers);
					const capiOrigin = new URL(this._capiUpstream).origin;
					const normalizedBody = this._normalize(replaceAll(decoded, capiOrigin, CAPI_PLACEHOLDER))
						.replace(SECRET_FIELD_RE, `$1"${SECRET_PLACEHOLDER}"`)
						.replace(SYSTEM_FIELD_RE, `$1"${SYSTEM_PROMPT_PLACEHOLDER}"`);
					this._recorded.push({
						method,
						path,
						requestBody: this._normalize(body),
						response: { status, headers: storedHeaders, body: normalizedBody },
					});
				});
			},
		);
		upstreamReq.on('error', err => this._fail(res, `upstream error: ${err instanceof Error ? err.message : String(err)}`));
		if (body) {
			upstreamReq.write(body);
		}
		upstreamReq.end();
	}

	private _upstreamFor(path: string): string {
		if (GITHUB_API_PREFIXES.some(prefix => path.startsWith(prefix))) {
			return this._githubUpstream;
		}
		return this._capiUpstream;
	}

	private get _capiUpstream(): string {
		const url = this._options.capiUpstreamUrl ?? this._options.upstreamUrl;
		if (!url) {
			throw new Error('[capi-replay] no CAPI upstream configured (set capiUpstreamUrl or upstreamUrl)');
		}
		return url;
	}

	private get _githubUpstream(): string {
		const url = this._options.githubUpstreamUrl ?? this._options.upstreamUrl;
		if (!url) {
			throw new Error('[capi-replay] no GitHub upstream configured (set githubUpstreamUrl or upstreamUrl)');
		}
		return url;
	}

	private _fail(res: http.ServerResponse, message: string): void {
		if (!res.headersSent) {
			res.writeHead(500, { 'content-type': 'text/plain', 'x-should-retry': 'false' });
		}
		res.end(`[capi-replay] ${message}`);
	}


	private _loadFixture(): void {
		const fixture = yamlModule.load(readFileSync(this._fixturePath, 'utf8')) as IFixture;
		const turnEndpoint = fixture.dialect ? DIALECT_ENDPOINT[fixture.dialect] : undefined;
		for (const exchange of fixture.exchanges) {
			let key: string;
			let item: IReplayItem;
			if (isTurnExchange(exchange)) {
				if (!turnEndpoint) {
					throw new Error(`[capi-replay] fixture has turn exchanges but no top-level dialect: ${this._fixturePath}`);
				}
				key = `${turnEndpoint.method} ${turnEndpoint.path}`;
				item = { kind: 'turn', dialect: fixture.dialect!, message: { content: deserializeAnthropicContent(exchange.response.content), stopReason: exchange.response.stopReason }, request: exchange.request };
			} else {
				key = `${exchange.method} ${exchange.path}`;
				item = { kind: 'raw', response: exchange.response };
			}
			let bucket = this._replayBuckets.get(key);
			if (!bucket) {
				bucket = { items: [], index: 0 };
				this._replayBuckets.set(key, bucket);
			}
			bucket.items.push(item);
		}
	}

	private _writeFixture(): void {
		const built = this._recorded.map(exchange => this._toFixtureExchange(exchange));
		const exchanges = built.map(b => b.exchange);
		this._normalizeToolCallIds(exchanges);
		this._normalizeUuids(exchanges);
		this._assertNoPosixOnlyCommands(exchanges);
		const dialect = built.find(b => b.dialect !== undefined)?.dialect;
		const fixture: IFixture = { version: 1, ...(dialect ? { dialect } : {}), exchanges };
		mkdirSync(dirname(this._fixturePath), { recursive: true });
		writeFileSync(this._fixturePath, yamlModule.dump(fixture, { lineWidth: -1, noRefs: true }));
	}

	private _assertNoPosixOnlyCommands(exchanges: IFixtureExchange[]): void {
		if (this._options.allowPosixCommands) {
			return;
		}
		const commands: IRecordedCommand[] = [];
		for (const exchange of exchanges) {
			if (!isTurnExchange(exchange)) {
				continue;
			}
			for (const block of deserializeAnthropicContent(exchange.response.content)) {
				if (block.type !== 'tool_use') {
					continue;
				}
				const command = getRecordedShellCommand(block.input as { command?: unknown; cmd?: unknown } | undefined);
				if (command) {
					commands.push({ command, toolName: block.name });
				}
			}
		}
		const findings = findPosixOnlyCommands(commands);
		if (findings.length > 0) {
			throw new Error(formatPosixCommandError(this._fixturePath, findings));
		}
	}

	private _normalizeToolCallIds(exchanges: IFixtureExchange[]): void {
		const idMap = new Map<string, string>();
		const mapId = (id: string): string => {
			let mapped = idMap.get(id);
			if (mapped === undefined) {
				mapped = `toolcall_${idMap.size}`;
				idMap.set(id, mapped);
			}
			return mapped;
		};
		for (const exchange of exchanges) {
			if (!isTurnExchange(exchange) || !Array.isArray(exchange.response.content)) {
				continue;
			}
			for (const block of exchange.response.content) {
				const b = block as { type?: string; id?: string };
				if (b.type === 'tool_use' && typeof b.id === 'string' && b.id) {
					b.id = mapId(b.id);
				}
			}
		}
		for (const exchange of exchanges) {
			if (!isTurnExchange(exchange)) {
				continue;
			}
			for (const message of exchange.request.messages) {
				const content = (message as { content?: unknown }).content;
				if (!Array.isArray(content)) {
					continue;
				}
				for (const block of content) {
					const b = block as { type?: string; tool_use_id?: string };
					if (b.type === 'tool_result' && typeof b.tool_use_id === 'string' && b.tool_use_id) {
						b.tool_use_id = mapId(b.tool_use_id);
					}
				}
			}
		}
	}

	private _normalizeUuids(exchanges: IFixtureExchange[]): void {
		const idMap = new Map<string, string>();
		const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
		const mapUuid = (uuid: string): string => {
			let mapped = idMap.get(uuid);
			if (mapped === undefined) {
				mapped = `\${uuid_${idMap.size}}`;
				idMap.set(uuid, mapped);
			}
			return mapped;
		};
		const walk = (value: unknown): unknown => {
			if (typeof value === 'string') {
				return value.replace(uuidRe, mapUuid);
			}
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					value[i] = walk(value[i]);
				}
				return value;
			}
			if (value && typeof value === 'object') {
				const obj = value as Record<string, unknown>;
				for (const key of Object.keys(obj)) {
					obj[key] = walk(obj[key]);
				}
				return value;
			}
			return value;
		};
		for (const exchange of exchanges) {
			walk(exchange);
		}
	}

	private _toFixtureExchange(exchange: IRecordedExchange): { exchange: IFixtureExchange; dialect?: TurnDialect } {
		if (exchange.method === 'POST' && exchange.path === ANTHROPIC_MESSAGES_PATH) {
			const request = summarizeAnthropicRequest(exchange.requestBody);
			const message = aggregateAnthropicSse(exchange.response.body);
			if (request && message) {
				const content = this._normalizeMessageContent(message.content);
				return { exchange: { request: this._normalizeRequest(request), response: { content: serializeAnthropicContent(content), stopReason: message.stopReason } }, dialect: 'anthropic' };
			}
		}
		if (exchange.method === 'POST' && exchange.path === RESPONSES_PATH) {
			const request = summarizeResponsesRequest(exchange.requestBody);
			const message = aggregateResponsesSse(exchange.response.body);
			if (request && message) {
				const content = this._normalizeMessageContent(message.content);
				return { exchange: { request: this._normalizeRequest(request), response: { content: serializeAnthropicContent(content), stopReason: message.stopReason } }, dialect: 'responses' };
			}
		}
		return { exchange: { method: exchange.method, path: exchange.path, response: exchange.response } };
	}

	private _normalizeMessageContent(content: AnthropicContentBlock[]): AnthropicContentBlock[] {
		return content.map((block): AnthropicContentBlock => {
			if (block.type === 'text') {
				return { type: 'text', text: this._normalizeValue(block.text) as string };
			}
			return { ...block, name: normalizeShellToolNameForCapture(block.name), input: this._normalizeValue(block.input) };
		});
	}

	private _normalizeRequest(request: IReadableAnthropicRequest): IReadableAnthropicRequest {
		return {
			...request,
			system: this._normalize(request.system),
			messages: request.messages.map(message => ({
				...message,
				content: this._normalizeValue(message.content),
			})),
		};
	}

	private _normalizeValue(value: unknown): unknown {
		if (typeof value === 'string') {
			const normalized = this._normalize(value);
			return isSerializedJson(normalized) ? normalized : normalizePlaceholderPathSeparators(normalized);
		}
		if (Array.isArray(value)) {
			return value.map(item => this._normalizeValue(item));
		}
		if (value && typeof value === 'object') {
			return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this._normalizeValue(item)]));
		}
		return value;
	}

	private _normalize(text: string): string {
		let result = text;
		if (this._workingDirectory) {
			const workDirs = new Set([this._workingDirectory]);
			try {
				workDirs.add(realpathSync.native(this._workingDirectory));
			} catch {
			}
			for (const workDir of [...workDirs].sort((a, b) => b.length - a.length)) {
				result = replacePath(result, workDir, WORKDIR_PLACEHOLDER, this._options.userName);
			}
		}
		const tempDirectories = new Set([tmpdir()]);
		try {
			tempDirectories.add(realpathSync.native(tmpdir()));
		} catch {
		}
		for (const tempDirectory of [...tempDirectories].sort((a, b) => b.length - a.length)) {
			result = replaceTemporaryWorkspacePaths(result, tempDirectory, WORKDIR_PLACEHOLDER, this._options.userName);
		}
		if (this._options.homeDir) {
			result = replacePath(result, this._options.homeDir, HOMEDIR_PLACEHOLDER, this._options.userName);
		}
		if (this._options.userName) {
			result = scrubUserName(result, this._options.userName);
		}
		result = result.replace(COPIED_PLUGIN_DIR_RE, (_match: string, directory: string) => {
			if (this._isReplaying && directory !== COPIED_PLUGIN_DIR_PLACEHOLDER) {
				this._replayPluginDirectories.add(directory);
			}
			return `${HOMEDIR_PLACEHOLDER}/user-data/agentPlugins/${COPIED_PLUGIN_DIR_PLACEHOLDER}`;
		});
		result = result.replace(TEMP_DIR_SUFFIX_RE, `$1${TEMP_DIR_SUFFIX_PLACEHOLDER}`);
		result = replaceAll(result, `/private${WORKDIR_PLACEHOLDER}`, WORKDIR_PLACEHOLDER);
		result = result.replace(FILE_LISTING_DATE_RE, '${timestamp}');
		return result;
	}

	private _expandReplayMessage(message: IAnthropicMessage): IAnthropicMessage {
		return {
			...message,
			content: message.content.map(block => {
				if (block.type === 'text') {
					return { ...block, text: this._expandReplayPlaceholders(block.text) };
				}
				if (block.type === 'tool_use') {
					return { ...block, name: expandShellToolName(block.name), input: this._expandReplayValue(block.input) };
				}
				return block;
			}),
		};
	}

	private _expandReplayValue(value: unknown): unknown {
		if (typeof value === 'string') {
			return this._expandReplayPlaceholders(value);
		}
		if (Array.isArray(value)) {
			return value.map(item => this._expandReplayValue(item));
		}
		if (value && typeof value === 'object') {
			const result: Record<string, unknown> = {};
			for (const [key, item] of Object.entries(value)) {
				result[key] = this._expandReplayValue(item);
			}
			return result;
		}
		return value;
	}

	private _expandReplayPlaceholders(text: string): string {
		let result = replaceAll(text, CAPI_PLACEHOLDER, this.url);
		if (result.includes(COPIED_PLUGIN_DIR_PLACEHOLDER)) {
			const directories = [...this._replayPluginDirectories];
			if (directories.length !== 1) {
				throw new Error(`[capi-replay] cannot resolve ${COPIED_PLUGIN_DIR_PLACEHOLDER}: expected one observed plugin directory, found ${directories.length}`);
			}
			result = replaceAll(result, COPIED_PLUGIN_DIR_PLACEHOLDER, directories[0]);
		}
		if (this._workingDirectory) {
			const workspaceName = basename(this._workingDirectory);
			const suffix = /-(?<suffix>[A-Za-z0-9]{6})$/.exec(workspaceName)?.groups?.suffix;
			let canonicalWorkingDirectory = this._workingDirectory;
			try {
				canonicalWorkingDirectory = realpathSync.native(this._workingDirectory);
			} catch {
			}
			if (suffix) {
				const workspaceStem = workspaceName.slice(0, -suffix.length);
				const normalizedWorkspaceName = `${workspaceStem}${TEMP_DIR_SUFFIX_PLACEHOLDER}`;
				const legacyWorkspacePlaceholder = `${WORKDIR_PLACEHOLDER}/${normalizedWorkspaceName}`;
				result = replaceAll(result, `/private${legacyWorkspacePlaceholder}`, canonicalWorkingDirectory);
				result = replaceAll(result, legacyWorkspacePlaceholder, this._workingDirectory);
				result = result.replace(
					new RegExp(`(?:\\/private)?${escapeRegExpCharacters(WORKDIR_PLACEHOLDER)}\\/${escapeRegExpCharacters(workspaceStem)}[A-Za-z0-9]{6}`, 'g'),
					match => match.startsWith('/private') ? canonicalWorkingDirectory : this._workingDirectory!,
				);
			}
			result = replaceAll(result, `/private${WORKDIR_PLACEHOLDER}`, canonicalWorkingDirectory);
			result = replaceAll(result, WORKDIR_PLACEHOLDER, this._workingDirectory);
			if (suffix) {
				result = replaceAll(result, TEMP_DIR_SUFFIX_PLACEHOLDER, suffix);
			}
		}
		if (this._options.homeDir) {
			result = replaceAll(result, HOMEDIR_PLACEHOLDER, this._options.homeDir);
		}
		if (this._options.userName) {
			result = replaceAll(result, USER_PLACEHOLDER, this._options.userName);
		}
		for (const [placeholder, value] of this._replayPlaceholderValues) {
			result = replaceAll(result, placeholder, value);
		}
		return result;
	}
}

function captureReplayPlaceholderValues(recorded: unknown, observed: unknown, values: Map<string, string>): void {
	if (typeof recorded === 'string' && typeof observed === 'string') {
		captureReplayPlaceholderValuesFromString(recorded, observed, values);
		return;
	}
	if (Array.isArray(recorded) && Array.isArray(observed)) {
		for (let index = 0; index < Math.min(recorded.length, observed.length); index++) {
			captureReplayPlaceholderValues(recorded[index], observed[index], values);
		}
		return;
	}
	if (!isRecord(recorded) || !isRecord(observed)) {
		return;
	}
	for (const [key, value] of Object.entries(recorded)) {
		captureReplayPlaceholderValues(value, observed[key], values);
	}
}

function captureReplayPlaceholderValuesFromString(recorded: string, observed: string, values: Map<string, string>): void {
	const placeholders: string[] = [];
	let pattern = '^';
	let offset = 0;
	for (const match of recorded.matchAll(UUID_PLACEHOLDER_RE)) {
		pattern += escapeRegExpCharacters(recorded.slice(offset, match.index));
		pattern += `(${UUID_PATTERN})`;
		placeholders.push(match[0]);
		offset = match.index + match[0].length;
	}
	if (placeholders.length === 0) {
		return;
	}
	pattern += `${escapeRegExpCharacters(recorded.slice(offset))}$`;
	const match = new RegExp(pattern, 'i').exec(observed);
	if (!match) {
		return;
	}
	const captured = new Map<string, string>();
	for (let index = 0; index < placeholders.length; index++) {
		const placeholder = placeholders[index];
		const value = match[index + 1];
		if ((captured.has(placeholder) && captured.get(placeholder) !== value)
			|| (values.has(placeholder) && values.get(placeholder) !== value)) {
			return;
		}
		captured.set(placeholder, value);
	}
	for (const [placeholder, value] of captured) {
		values.set(placeholder, value);
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function replaceAll(text: string, search: string, replacement: string): string {
	if (!search) {
		return text;
	}
	return text.split(search).join(replacement);
}

function pathVariants(search: string, replacement: string, userName: string | undefined): ReadonlyMap<string, string> {
	const variants = new Map<string, string>([
		[search, replacement],
		[escapeJsonString(search), replacement],
	]);
	const fileUriReplacement = `file://${replacement}`;
	for (const fileUri of [URI.file(search).toString(), URI.file(search).toString(true)]) {
		variants.set(fileUri, fileUriReplacement);
		variants.set(escapeJsonString(fileUri), fileUriReplacement);
	}
	if (isWindows) {
		const forwardSlashPath = search.replaceAll('\\', '/');
		const backslashPath = search.replaceAll('/', '\\');
		variants.set(forwardSlashPath, replacement);
		variants.set(escapeJsonString(forwardSlashPath), replacement);
		variants.set(backslashPath, replacement);
		variants.set(escapeJsonString(backslashPath), replacement);
	}
	if (userName) {
		for (const [variant, variantReplacement] of [...variants]) {
			variants.set(scrubUserName(variant, userName), variantReplacement);
		}
	}
	return variants;
}

function replacePath(text: string, search: string, replacement: string, userName?: string): string {
	const variants = pathVariants(search, replacement, userName);
	for (const [variant, variantReplacement] of [...variants].sort(([a], [b]) => b.length - a.length)) {
		text = isWindows
			? text.replace(new RegExp(escapeRegExpCharacters(variant), 'gi'), variantReplacement)
			: replaceAll(text, variant, variantReplacement);
	}
	return text;
}

function replaceTemporaryWorkspacePaths(text: string, tempDirectory: string, replacement: string, userName?: string): string {
	const variants = pathVariants(tempDirectory, replacement, userName);
	for (const [variant, variantReplacement] of [...variants].sort(([a], [b]) => b.length - a.length)) {
		const pattern = `${escapeRegExpCharacters(variant)}${PATH_SEPARATOR_PATTERN}${TEMP_WORKSPACE_COMPONENT_PATTERN}`;
		text = text.replace(new RegExp(pattern, isWindows ? 'gi' : 'g'), variantReplacement);
	}
	return text;
}

function normalizePlaceholderPathSeparators(text: string): string {
	return text.replace(/\$\{(?:workdir|homedir)\}(?:[\\/][^\r\n"'`]*)?/g, path => path.replaceAll('\\', '/'));
}

function isSerializedJson(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
		return false;
	}
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

function escapeJsonString(value: string): string {
	return JSON.stringify(value).slice(1, -1);
}

function escapeRegExpCharacters(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeBody(buffer: Buffer, encoding: string | undefined): string {
	try {
		switch (encoding?.trim().toLowerCase()) {
			case 'gzip': return zlibModule.gunzipSync(buffer).toString('utf8');
			case 'br': return zlibModule.brotliDecompressSync(buffer).toString('utf8');
			case 'deflate': return zlibModule.inflateSync(buffer).toString('utf8');
			default: return buffer.toString('utf8');
		}
	} catch {
		return buffer.toString('utf8');
	}
}

function flattenHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined) {
			continue;
		}
		result[key] = Array.isArray(value) ? value.join(', ') : value;
	}
	return result;
}

function filterRecordedResponseHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(headers).filter(([key]) => STORED_RESPONSE_HEADERS.has(key.toLowerCase())));
}
