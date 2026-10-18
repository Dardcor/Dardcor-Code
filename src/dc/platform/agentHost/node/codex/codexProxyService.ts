/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import * as fs from 'fs';
import { join } from '../../../../base/common/path.js';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { DardcorRouterApiError, IDardcorRouterService } from '../shared/dardcorRouterService.js';
import { buildForwardedChatError, encodeForwardedChatError } from '../shared/proxyChatError.js';
import {
	ILoopbackProxyHandle,
	ILoopbackProxyRuntime,
	IProxyInFlight,
	LoopbackProxyServer,
	readProxyRequestBody,
} from '../shared/loopbackProxyServer.js';

export interface ICodexProxyHandle extends ILoopbackProxyHandle {
	readonly baseUrl: string;
	readonly nonce: string;
}

export interface ICodexProxyService {
	readonly _serviceBrand: undefined;

	start(): Promise<ICodexProxyHandle>;

	dispose(): void;
}

export const ICodexProxyService = createDecorator<ICodexProxyService>('codexProxyService');

interface ICodexProxyState {
	lastPrimaryModel: string | undefined;
}

const CODEX_AUTO_REVIEW_MODEL = 'codex-auto-review';

type ICodexProxyRuntime = ILoopbackProxyRuntime<ICodexProxyState>;

const PROXY_USER_FACING_NAME = 'CodexProxyService';

const USER_AGENT_PREFIX = 'vscode_codex';

const DEBUG_DUMP_DIR_ENV = 'VSCODE_CODEX_PROXY_DUMP_DIR';

let _dumpSeq = 0;
function nextDumpSeq(): string {
	return String(++_dumpSeq).padStart(4, '0');
}

function getDumpDir(): string | undefined {
	const dir = process.env[DEBUG_DUMP_DIR_ENV];
	if (!dir) {
		return undefined;
	}
	try {
		fs.mkdirSync(dir, { recursive: true });
		return dir;
	} catch {
		return undefined;
	}
}

function writeJsonError(res: http.ServerResponse, status: number, type: string, message: string): void {
	if (res.headersSent || res.writableEnded) {
		return;
	}
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify({ error: { type, message } }));
}

export class CodexProxyService extends LoopbackProxyServer<ICodexProxyState> implements ICodexProxyService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService logService: ILogService,
		@IDardcorRouterService private readonly _dardcorRouterService: IDardcorRouterService,
	) {
		super(PROXY_USER_FACING_NAME, logService);
	}

	protected createState(_seed: void): ICodexProxyState {
		return { lastPrimaryModel: undefined };
	}

	async start(): Promise<ICodexProxyHandle> {
		const { runtime, release } = await this.acquire(undefined);

		let disposed = false;
		return {
			baseUrl: runtime.baseUrl,
			nonce: runtime.nonce,
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				release();
			},
		};
	}

	protected override async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: ICodexProxyRuntime,
	): Promise<void> {
		const method = req.method ?? 'GET';
		const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
		const incomingHeaders = Object.keys(req.headers).join(', ');
		this._logService.info(`[${PROXY_USER_FACING_NAME}] >>> ${method} ${pathname} (headers: ${incomingHeaders})`);

		if (method === 'GET' && pathname === '/') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('ok');
			return;
		}

		const authHeader = req.headers['authorization'];
		const expected = `Bearer ${runtime.nonce}`;
		if (typeof authHeader !== 'string' || authHeader !== expected) {
			writeJsonError(res, 401, 'authentication_error', 'Invalid authentication');
			return;
		}

		if (method === 'GET' && pathname === '/v1/models') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ models: [] }));
			return;
		}

		if (method === 'POST' && (pathname === '/v1/responses' || pathname === '/responses' || pathname === '//responses')) {
			await this._handleResponses(req, res, runtime);
			return;
		}

		writeJsonError(res, 404, 'not_found_error', `No route for ${method} ${pathname}`);
	}

	private async _handleResponses(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: ICodexProxyRuntime,
	): Promise<void> {
		let body: string;
		try {
			body = await readProxyRequestBody(req);
		} catch (err) {
			writeJsonError(res, 400, 'invalid_request_error', `Failed to read request body: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		const remap = remapCodexReviewerModel(body, runtime.state);
		if (remap.remappedFrom) {
			this._logService.info(`[${PROXY_USER_FACING_NAME}] remapped unsupported reviewer model '${remap.remappedFrom}' -> '${remap.remappedTo}'`);
		}
		body = remap.body;

		const dumpDir = getDumpDir();
		const dumpSeq = dumpDir ? nextDumpSeq() : undefined;
		if (dumpDir && dumpSeq) {
			const reqFile = join(dumpDir, `req-${dumpSeq}-${Date.now()}.json`);
			try {
				fs.writeFileSync(reqFile, body);
				this._logService.info(`[${PROXY_USER_FACING_NAME}] dumped request body to ${reqFile}`);
			} catch (err) {
				this._logService.warn(`[${PROXY_USER_FACING_NAME}] failed to dump request body: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		try {
			const parsed = JSON.parse(body);
			this._logService.info(`[${PROXY_USER_FACING_NAME}] >>> /responses body: model=${parsed.model ?? '<none>'}, previous_response_id=${parsed.previous_response_id ?? '<none>'}, stream=${parsed.stream ?? '<none>'}, input_items=${Array.isArray(parsed.input) ? parsed.input.length : '<not-array>'}`);
			if (Array.isArray(parsed.input)) {
				for (let i = 0; i < parsed.input.length; i++) {
					const item = parsed.input[i];
					const type = item?.type ?? '<none>';
					const keys = item && typeof item === 'object' ? Object.keys(item).join(',') : typeof item;
					let detail = '';
					if (type === 'message') {
						const text: string = item?.content?.[0]?.text ?? '';
						detail = `role=${item?.role ?? '?'} chars=${text.length}`;
					} else if (type === 'function_call') {
						detail = `name=${item?.name ?? '?'} call_id=${item?.call_id ?? '?'}`;
					} else if (type === 'function_call_output') {
						const output = item?.output ?? '';
						detail = `call_id=${item?.call_id ?? '?'} output_chars=${typeof output === 'string' ? output.length : 0}`;
					} else if (type === 'reasoning') {
						const summary = item?.summary ?? item?.content ?? '';
						detail = `summary_chars=${typeof summary === 'string' ? summary.length : JSON.stringify(summary).length} encrypted=${typeof item?.encrypted_content === 'string'}`;
					} else {
						detail = JSON.stringify(item).slice(0, 120);
					}
					this._logService.info(`[${PROXY_USER_FACING_NAME}]   input[${i}] type=${type} keys=[${keys}] ${detail}`);
				}
			}
			const topLevelKeys = Object.keys(parsed).filter(k => k !== 'input').sort();
			this._logService.info(`[${PROXY_USER_FACING_NAME}]   top-level keys (excl. input)=[${topLevelKeys.join(', ')}]`);
			for (const k of topLevelKeys) {
				if (k === 'instructions' || k === 'tools') {
					const v = parsed[k];
					const size = typeof v === 'string' ? v.length : JSON.stringify(v).length;
					this._logService.info(`[${PROXY_USER_FACING_NAME}]     ${k}=<${size} chars elided>`);
					continue;
				}
				const v = parsed[k];
				const preview = typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v);
				this._logService.info(`[${PROXY_USER_FACING_NAME}]     ${k}=${preview}`);
			}
		} catch {
			this._logService.info(`[${PROXY_USER_FACING_NAME}] >>> /responses body (unparseable): ${body.slice(0, 200)}`);
		}

		const entry: IProxyInFlight = { ac: new AbortController(), res, clientGone: false };
		runtime.inFlight.add(entry);
		const onClose = () => {
			entry.clientGone = true;
			entry.ac.abort();
		};
		res.on('close', onClose);

		const headers = buildOutboundHeaders(req.headers);

		try {
			this._logService.info(`[${PROXY_USER_FACING_NAME}] forwarding to Dardcor Router responses...`);
			const upstream = await this._dardcorRouterService.responses(body, { headers, signal: entry.ac.signal });
			const contentType = upstream.headers.get('content-type') ?? 'application/json';
			const upstreamHeaders = [...upstream.headers.entries()].map(([k, v]) => `${k}: ${v}`).join(', ');
			this._logService.info(`[${PROXY_USER_FACING_NAME}] <<< Router response: status=${upstream.status}, contentType=${contentType}, headers=[${upstreamHeaders}]`);
			res.writeHead(upstream.status, { 'Content-Type': contentType });
			if (!upstream.body) {
				res.end();
				return;
			}
			const reader = upstream.body.getReader();
			const resDumpStream = dumpDir && dumpSeq
				? fs.createWriteStream(join(dumpDir, `res-${dumpSeq}-${Date.now()}.txt`))
				: undefined;
			let sseBuf = '';
			const eventCounts: Record<string, number> = {};
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) {
						break;
					}
					if (entry.clientGone) {
						break;
					}
					if (value && value.byteLength > 0) {
						const buf = Buffer.from(value);
						res.write(buf);
						if (resDumpStream) {
							resDumpStream.write(buf);
						}
						sseBuf += buf.toString('utf8');
						let nl: number;
						while ((nl = sseBuf.indexOf('\n')) >= 0) {
							const line = sseBuf.slice(0, nl).trimEnd();
							sseBuf = sseBuf.slice(nl + 1);
							if (line.startsWith('event:')) {
								const ev = line.slice('event:'.length).trim();
								eventCounts[ev] = (eventCounts[ev] ?? 0) + 1;
							}
						}
					}
				}
			} finally {
				try { reader.releaseLock(); } catch { }
				resDumpStream?.end();
			}
			if (Object.keys(eventCounts).length) {
				const summary = Object.entries(eventCounts).map(([k, v]) => `${k}=${v}`).join(', ');
				this._logService.info(`[${PROXY_USER_FACING_NAME}] <<< SSE event counts: ${summary}`);
			}
			res.end();
		} catch (err) {
			if (entry.clientGone) {
				this._logService.info(`[${PROXY_USER_FACING_NAME}] client disconnected during upstream call`);
				return;
			}
			if (err instanceof DardcorRouterApiError) {
				this._logService.error(`[${PROXY_USER_FACING_NAME}] CAPI error: status=${err.status}, message=${err.message}`);
				const marker = encodeForwardedChatError(buildForwardedChatError(err));
				writeJsonError(res, err.status, 'api_error', `${err.message} ${marker}`);
				return;
			}
			this._logService.error(`[${PROXY_USER_FACING_NAME}] upstream error: ${err instanceof Error ? err.message : String(err)}`);
			writeJsonError(res, 502, 'api_error', err instanceof Error ? err.message : String(err));
		} finally {
			res.removeListener('close', onClose);
			runtime.inFlight.delete(entry);
		}
	}
}

export function remapCodexReviewerModel(
	body: string,
	state: { lastPrimaryModel: string | undefined },
): { readonly body: string; readonly remappedFrom?: string; readonly remappedTo?: string } {
	let parsed: { model?: unknown };
	try {
		parsed = JSON.parse(body);
	} catch {
		return { body };
	}
	const model = typeof parsed.model === 'string' ? parsed.model : undefined;
	if (!model) {
		return { body };
	}
	if (model !== CODEX_AUTO_REVIEW_MODEL) {
		state.lastPrimaryModel = model;
		return { body };
	}
	const target = state.lastPrimaryModel;
	if (!target) {
		return { body };
	}
	(parsed as { model: string }).model = target;
	return { body: JSON.stringify(parsed), remappedFrom: model, remappedTo: target };
}


function buildOutboundHeaders(inbound: http.IncomingHttpHeaders): Record<string, string> {
	const out: Record<string, string> = {};
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
