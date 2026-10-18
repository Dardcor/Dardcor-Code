/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type Anthropic from '@anthropic-ai/sdk';
import type { IDardcorRouterModel } from '../../common/dardcorRouterModel.js';
import type * as http from 'http';
import { once } from 'events';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { Event } from '../../../../base/common/event.js';
import {
	DARDCOR_ROUTER_ERROR_STATUS_STREAMING,
	DardcorRouterApiError,
	IDardcorRouterService,
} from '../shared/dardcorRouterService.js';
import { buildForwardedChatError, encodeForwardedChatError } from '../shared/proxyChatError.js';
import {
	IProxyInFlight,
	ILoopbackProxyHandle,
	ILoopbackProxyRuntime,
	LoopbackProxyServer,
	readProxyRequestBody,
} from '../shared/loopbackProxyServer.js';
import { filterSupportedBetas } from './anthropicBetas.js';
import {
	buildErrorEnvelope,
	formatSseErrorFrame,
	writeJsonError,
	writeUpstreamJsonError,
} from './anthropicErrors.js';
import { tryParseClaudeModelId } from './claudeModelId.js';
import { parseProxyBearer } from './claudeProxyAuth.js';


export interface IClaudeProxyCreditsReport {
	readonly sessionId: string;
	readonly totalNanoAiu: number;
}

export interface IClaudeProxyHandle extends ILoopbackProxyHandle {
	readonly baseUrl: string;
	readonly nonce: string;
}

export type ClaudeTransport =
	| { readonly kind: 'proxy'; readonly handle: IClaudeProxyHandle }
	| { readonly kind: 'native' };

export interface IClaudeProxyService {
	readonly _serviceBrand: undefined;
	readonly onDidReportCredits?: Event<IClaudeProxyCreditsReport>;

	start(token?: string): Promise<IClaudeProxyHandle>;

	dispose(): void;
}

export const IClaudeProxyService = createDecorator<IClaudeProxyService>('claudeProxyService');



type IClaudeProxyState = Record<string, never>;

type IClaudeProxyRuntime = ILoopbackProxyRuntime<IClaudeProxyState>;



const KNOWN_CLAUDE_VENDORS = new Set(['anthropic']);
const ANTHROPIC_MESSAGES_ENDPOINT = '/v1/messages';
const PROXY_USER_FACING_NAME = 'ClaudeRouterProxyService';
const USER_AGENT_PREFIX = 'dardcor_claude_code';

export class ClaudeProxyService extends LoopbackProxyServer<IClaudeProxyState> implements IClaudeProxyService {

	declare readonly _serviceBrand: undefined;


	constructor(
		@ILogService logService: ILogService,
		@IDardcorRouterService private readonly _dardcorRouterService: IDardcorRouterService,
	) {
		super(PROXY_USER_FACING_NAME, logService);
	}

	protected createState(_seed: void): IClaudeProxyState {
		return {};
	}

	readonly onDidReportCredits: Event<IClaudeProxyCreditsReport> = Event.None;

	async start(_token?: string): Promise<IClaudeProxyHandle> {
		const { runtime, release } = await this.acquire(undefined);
		return {
			baseUrl: runtime.baseUrl,
			nonce: runtime.nonce,
			dispose: release,
		};
	}

	override dispose(): void {
		super.dispose();
	}

	protected override writeInternalError(res: http.ServerResponse): void {
		writeJsonError(res, 500, 'api_error', 'Internal proxy error');
	}

	protected override async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: IClaudeProxyRuntime,
	): Promise<void> {
		const method = req.method ?? 'GET';
		const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
		this._logService.trace(`[${PROXY_USER_FACING_NAME}] ${method} ${pathname}`);

		if (method === 'GET' && pathname === '/') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('ok');
			return;
		}

		const auth = parseProxyBearer(req.headers, runtime.nonce);
		if (!auth.valid) {
			writeJsonError(res, 401, 'authentication_error', 'Invalid authentication');
			return;
		}

		if (method === 'GET' && pathname === '/v1/models') {
			await this._handleModels(req, res);
			return;
		}
		if (method === 'POST' && pathname === '/v1/messages') {
			await this._handleMessages(req, res, runtime);
			return;
		}
		if (method === 'POST' && pathname === '/v1/messages/count_tokens') {
			await this._handleCountTokens(req, res, runtime);
			return;
		}

		writeJsonError(res, 404, 'not_found_error', `No route for ${method} ${pathname}`);
	}

	private async _handleModels(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		let models: IDardcorRouterModel[];
		try {
			models = await this._dardcorRouterService.models({ headers: buildOutboundHeaders(req.headers) });
		} catch (err) {
			this._writeUpstreamErrorResponse(res, err);
			return;
		}

		const data: Anthropic.ModelInfo[] = [];
		for (const model of models) {
			if (!isAnthropicMessagesModel(model)) {
				continue;
			}
			const parsed = tryParseClaudeModelId(model.id);
			const sdkId = parsed ? parsed.toSdkModelId() : model.id;
			data.push({
				id: sdkId,
				type: 'model',
				display_name: model.name || sdkId,
				created_at: '1970-01-01T00:00:00Z',
				capabilities: null,
				max_input_tokens: null,
				max_tokens: null,
			});
		}

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			data,
			has_more: false,
			first_id: data[0]?.id ?? null,
			last_id: data[data.length - 1]?.id ?? null,
		}));
	}

	private async _handleMessages(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: IClaudeProxyRuntime,
	): Promise<void> {
		let bodyString: string;
		try {
			bodyString = await readProxyRequestBody(req);
		} catch (err) {
			writeJsonError(res, 400, 'invalid_request_error', `Failed to read request body: ${stringifyError(err)}`);
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(bodyString);
		} catch {
			writeJsonError(res, 400, 'invalid_request_error', 'Request body is not valid JSON');
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			writeJsonError(res, 400, 'invalid_request_error', 'Request body must be a JSON object');
			return;
		}

		const body = parsed as Record<string, unknown>;
		if (typeof body.model !== 'string' || body.model.length === 0) {
			writeJsonError(res, 400, 'invalid_request_error', 'Missing required field: model');
			return;
		}
		if (!Array.isArray(body.messages)) {
			writeJsonError(res, 400, 'invalid_request_error', 'Missing required field: messages');
			return;
		}

		const originalSdkModelId = body.model;
		const parsedModel = tryParseClaudeModelId(originalSdkModelId);
		if (!parsedModel) {
			writeJsonError(res, 404, 'not_found_error', `Unknown model: ${originalSdkModelId}`);
			return;
		}
		body.model = parsedModel.toEndpointModelId();

		const entry: IProxyInFlight = { ac: new AbortController(), res, clientGone: false };
		runtime.inFlight.add(entry);
		const onClose = () => {
			entry.clientGone = true;
			entry.ac.abort();
		};
		res.on('close', onClose);

		try {
			const headers = buildOutboundHeaders(req.headers);
			if (body.stream === true) {
				await this._streamMessages(body as unknown as Anthropic.MessageCreateParamsStreaming, headers, res, entry, originalSdkModelId);
			} else {
				await this._sendNonStreamingMessage(body as unknown as Anthropic.MessageCreateParamsNonStreaming, headers, res, entry, originalSdkModelId);
			}
		} finally {
			res.removeListener('close', onClose);
			runtime.inFlight.delete(entry);
		}
	}

	private async _handleCountTokens(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: IClaudeProxyRuntime,
	): Promise<void> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(await readProxyRequestBody(req));
		} catch (err) {
			writeJsonError(res, 400, 'invalid_request_error', `Invalid token-count request: ${stringifyError(err)}`);
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			writeJsonError(res, 400, 'invalid_request_error', 'Request body must be a JSON object');
			return;
		}

		const body = parsed as Record<string, unknown>;
		if (typeof body.model !== 'string' || !Array.isArray(body.messages)) {
			writeJsonError(res, 400, 'invalid_request_error', 'Token-count request requires model and messages');
			return;
		}
		const parsedModel = tryParseClaudeModelId(body.model);
		if (!parsedModel) {
			writeJsonError(res, 404, 'not_found_error', `Unknown model: ${body.model}`);
			return;
		}
		body.model = parsedModel.toEndpointModelId();

		const entry: IProxyInFlight = { ac: new AbortController(), res, clientGone: false };
		runtime.inFlight.add(entry);
		const onClose = () => {
			entry.clientGone = true;
			entry.ac.abort();
		};
		res.on('close', onClose);
		try {
			const result = await this._dardcorRouterService.countTokens(
				body as unknown as Anthropic.MessageCountTokensParams,
				{ headers: buildOutboundHeaders(req.headers), signal: entry.ac.signal },
			);
			if (!res.writableEnded && !entry.ac.signal.aborted) {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(result));
			}
		} catch (err) {
			if (entry.ac.signal.aborted) {
				if (!entry.clientGone && !res.writableEnded) {
					res.destroy();
				}
			} else {
				this._writeUpstreamErrorResponse(res, err, true);
			}
		} finally {
			res.removeListener('close', onClose);
			runtime.inFlight.delete(entry);
		}
	}

	private async _sendNonStreamingMessage(
		body: Anthropic.MessageCreateParamsNonStreaming,
		headers: Record<string, string>,
		res: http.ServerResponse,
		entry: IProxyInFlight,
		originalSdkModelId: string,
	): Promise<void> {
		let message: Anthropic.Message;
		try {
			message = await this._dardcorRouterService.messages(body, { headers, signal: entry.ac.signal });
		} catch (err) {
			if (entry.ac.signal.aborted) {
				if (!entry.clientGone && !res.writableEnded) {
					res.destroy();
				}
				return;
			}
			this._writeUpstreamErrorResponse(res, err, true);
			return;
		}

		const outboundModel = rewriteModelToSdk(message.model, this._logService) ?? originalSdkModelId;
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ ...message, model: outboundModel }));
	}

	private async _streamMessages(
		body: Anthropic.MessageCreateParamsStreaming,
		headers: Record<string, string>,
		res: http.ServerResponse,
		entry: IProxyInFlight,
		_originalSdkModelId: string,
	): Promise<void> {
		let stream: AsyncGenerator<Anthropic.MessageStreamEvent>;
		try {
			stream = this._dardcorRouterService.messages(body, { headers, signal: entry.ac.signal });
		} catch (err) {
			if (entry.ac.signal.aborted) {
				if (!entry.clientGone && !res.writableEnded) {
					res.destroy();
				}
			} else {
				this._writeUpstreamErrorResponse(res, err, true);
			}
			return;
		}

		let first: IteratorResult<Anthropic.MessageStreamEvent>;
		try {
			first = await stream.next();
		} catch (err) {
			if (entry.ac.signal.aborted) {
				if (!entry.clientGone && !res.writableEnded) {
					res.destroy();
				}
			} else {
				this._writeUpstreamErrorResponse(res, err, true);
			}
			return;
		}

		res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
		res.flushHeaders();
		req_setNoDelay(res);

		const writeFrame = async (event: Anthropic.MessageStreamEvent): Promise<boolean> => {
			const transformed = rewriteEventModel(event, this._logService);
			const ok = res.write(`event: ${transformed.type}\ndata: ${JSON.stringify(transformed)}\n\n`);
			if (!ok) {
				try {
					await once(res, 'drain', { signal: entry.ac.signal });
				} catch {
					return false;
				}
			}
			return true;
		};

		try {
			if (!first.done && !await writeFrame(first.value)) {
				return;
			}
			while (true) {
				let next: IteratorResult<Anthropic.MessageStreamEvent>;
				try {
					next = await stream.next();
				} catch (err) {
					if (entry.ac.signal.aborted) {
						if (!entry.clientGone && !res.writableEnded) {
							res.destroy();
						}
						return;
					}
					const envelope = err instanceof DardcorRouterApiError
						? embedForwardedChatError(err)
						: buildErrorEnvelope('api_error', stringifyError(err));
					if (!res.writableEnded) {
						try { res.write(formatSseErrorFrame(envelope)); } catch { /* socket may have closed */ }
						try { res.end(); } catch { /* socket may have closed */ }
					}
					return;
				}
				if (next.done) {
					break;
				}
				if (!await writeFrame(next.value)) {
					return;
				}
			}
			if (!res.writableEnded) {
				res.end();
			}
		} catch (err) {
			this._logService.warn(`[${PROXY_USER_FACING_NAME}] stream loop unexpected error: ${stringifyError(err)}`);
			if (!res.writableEnded) {
				try { res.end(); } catch { /* socket may have closed */ }
			}
		}
	}

	private _writeUpstreamErrorResponse(res: http.ServerResponse, err: unknown, embedChatError = false): void {
		if (res.headersSent) {
			this._logService.warn(`[${PROXY_USER_FACING_NAME}] cannot write upstream error after headers sent: ${stringifyError(err)}`);
			if (!res.writableEnded) {
				try { res.end(); } catch { }
			}
			return;
		}
		if (err instanceof DardcorRouterApiError) {
			const status = err.status === DARDCOR_ROUTER_ERROR_STATUS_STREAMING ? 502 : err.status;
			writeUpstreamJsonError(res, status, embedChatError ? embedForwardedChatError(err) : err.envelope);
			return;
		}
		writeJsonError(res, 502, 'api_error', err instanceof Error ? err.message : String(err));
	}

}



function isAnthropicMessagesModel(m: IDardcorRouterModel): boolean {
	if (!KNOWN_CLAUDE_VENDORS.has(m.vendor.toLowerCase())) {
		return false;
	}
	return Array.isArray(m.supported_endpoints) && m.supported_endpoints.includes(ANTHROPIC_MESSAGES_ENDPOINT);
}

function rewriteModelToSdk(modelId: string, logService: ILogService): string | undefined {
	const parsed = tryParseClaudeModelId(modelId);
	if (!parsed) {
		logService.warn(`[${PROXY_USER_FACING_NAME}] outbound model ID could not be parsed for SDK rewrite: ${modelId}`);
		return undefined;
	}
	return parsed.toSdkModelId();
}

function rewriteEventModel(
	event: Anthropic.MessageStreamEvent,
	logService: ILogService,
): Anthropic.MessageStreamEvent {
	if (event.type !== 'message_start') {
		return event;
	}
	const sdkModel = rewriteModelToSdk(event.message.model, logService);
	if (sdkModel === undefined || sdkModel === event.message.model) {
		return event;
	}
	return {
		...event,
		message: { ...event.message, model: sdkModel },
	};
}

function buildOutboundHeaders(inbound: http.IncomingHttpHeaders): Record<string, string> {
	const out: Record<string, string> = {};
	const version = inbound['anthropic-version'];
	if (typeof version === 'string' && version.length > 0) {
		out['anthropic-version'] = version;
	}
	const beta = inbound['anthropic-beta'];
	if (typeof beta === 'string' && beta.length > 0) {
		const filtered = filterSupportedBetas(beta);
		if (filtered !== undefined) {
			out['anthropic-beta'] = filtered;
		}
	}
	const userAgent = inbound['user-agent'];
	if (typeof userAgent === 'string' && userAgent.length > 0) {
		out['User-Agent'] = transformUserAgent(userAgent);
	}
	return out;
}

function transformUserAgent(userAgent: string): string {
	const slashIndex = userAgent.indexOf('/');
	if (slashIndex === -1) {
		return `${USER_AGENT_PREFIX}/${userAgent}`;
	}
	return `${USER_AGENT_PREFIX}${userAgent.substring(slashIndex)}`;
}

function req_setNoDelay(res: http.ServerResponse): void {
	const socket = res.socket;
	if (socket && typeof socket.setNoDelay === 'function') {
		try {
			socket.setNoDelay(true);
		} catch {
		}
	}
}

function stringifyError(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

function embedForwardedChatError(err: DardcorRouterApiError): Anthropic.ErrorResponse {
	const marker = encodeForwardedChatError(buildForwardedChatError(err));
	return {
		...err.envelope,
		error: {
			...err.envelope.error,
			message: `${err.envelope.error.message} ${marker}`,
		},
	};
}
