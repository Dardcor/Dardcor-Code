/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { createDecorator } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import { IByokLmBridgeRegistry } from '../byokLmBridgeRegistry.js';
import { parseProxyBearer } from '../claude/claudeProxyAuth.js';
import {
	ILoopbackProxyHandle,
	ILoopbackProxyRuntime,
	IProxyInFlight,
	LoopbackProxyServer,
	readProxyRequestBody,
} from './loopbackProxyServer.js';
import {
	bridgeResultToResponsesBody,
	bridgeResultToResponsesSseFrames,
	IResponsesRequest,
	responsesErrorBody,
	responsesRequestToBridge,
	ResponsesTranslationError,
} from './byokResponsesTranslation.js';


export interface IByokLmProxyHandle extends ILoopbackProxyHandle {
	readonly baseUrl: string;
	readonly nonce: string;
	providerBaseUrl(vendor: string): string;
}

export const IByokLmProxyService = createDecorator<IByokLmProxyService>('byokLmProxyService');

export interface IByokLmProxyService {
	readonly _serviceBrand: undefined;

	start(): Promise<IByokLmProxyHandle>;

	dispose(): void;
}


const PROXY_USER_FACING_NAME = 'ByokLmProxyService';
const VENDOR_PATH_PREFIX = '/v/';
const RESPONSES_SUFFIX = '/responses';

type ByokLmProxyState = undefined;

export class ByokLmProxyService extends LoopbackProxyServer<ByokLmProxyState> implements IByokLmProxyService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ILogService logService: ILogService,
		@IByokLmBridgeRegistry private readonly _bridgeRegistry: IByokLmBridgeRegistry,
	) {
		super(PROXY_USER_FACING_NAME, logService);
	}

	protected createState(): ByokLmProxyState {
		return undefined;
	}

	async start(): Promise<IByokLmProxyHandle> {
		const { runtime, release } = await this.acquire();

		let disposed = false;
		return {
			baseUrl: runtime.baseUrl,
			nonce: runtime.nonce,
			providerBaseUrl: (vendor: string) => `${runtime.baseUrl}${VENDOR_PATH_PREFIX}${encodeURIComponent(vendor)}`,
			dispose: () => {
				if (disposed) {
					return;
				}
				disposed = true;
				release();
			},
		};
	}

	protected override writeInternalError(res: http.ServerResponse): void {
		this._writeJsonError(res, 500, 'Internal proxy error');
	}

	protected override async handleRequest(req: http.IncomingMessage, res: http.ServerResponse, runtime: ILoopbackProxyRuntime<ByokLmProxyState>): Promise<void> {
		const method = req.method ?? 'GET';
		const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
		this._logService.trace(`[${PROXY_USER_FACING_NAME}] ${method} ${pathname}`);

		if (method === 'GET' && pathname === '/') {
			res.writeHead(200, { 'Content-Type': 'text/plain' });
			res.end('ok');
			return;
		}

		const auth = parseProxyBearer(req.headers, runtime.nonce);
		if (!auth.valid || !auth.sessionId) {
			this._writeJsonError(res, 401, 'Invalid authentication', 'authentication_error');
			return;
		}

		const vendor = this._parseVendorFromResponsesPath(pathname);
		if (method === 'POST' && vendor !== undefined) {
			await this._handleResponses(req, res, runtime, vendor);
			return;
		}

		this._writeJsonError(res, 404, `No route for ${method} ${pathname}`, 'not_found_error');
	}

	private _parseVendorFromResponsesPath(pathname: string): string | undefined {
		if (!pathname.startsWith(VENDOR_PATH_PREFIX) || !pathname.endsWith(RESPONSES_SUFFIX)) {
			return undefined;
		}
		const vendorSegment = pathname.slice(VENDOR_PATH_PREFIX.length, pathname.length - RESPONSES_SUFFIX.length);
		if (!vendorSegment) {
			return undefined;
		}
		let vendor: string;
		try {
			vendor = decodeURIComponent(vendorSegment);
		} catch {
			return undefined;
		}
		if (!vendor || vendor.includes('/')) {
			return undefined;
		}
		return vendor;
	}

	private async _handleResponses(req: http.IncomingMessage, res: http.ServerResponse, runtime: ILoopbackProxyRuntime<ByokLmProxyState>, vendor: string): Promise<void> {
		let body: IResponsesRequest;
		try {
			const raw = await readProxyRequestBody(req);
			body = JSON.parse(raw) as IResponsesRequest;
		} catch (err) {
			this._writeJsonError(res, 400, `Invalid request body: ${err instanceof Error ? err.message : String(err)}`, 'invalid_request_error');
			return;
		}

		let bridgeRequest;
		try {
			bridgeRequest = responsesRequestToBridge(vendor, body);
		} catch (err) {
			const message = err instanceof ResponsesTranslationError ? err.message : String(err);
			this._writeJsonError(res, 400, message, 'invalid_request_error');
			return;
		}

		const connection = this._bridgeRegistry.getServingConnection();
		if (!connection) {
			this._writeJsonError(res, 503, 'No renderer connection available to service BYOK models', 'api_error');
			return;
		}

		const entry: IProxyInFlight = { ac: new AbortController(), res, clientGone: false };
		runtime.inFlight.add(entry);
		const onClose = () => {
			entry.clientGone = true;
			entry.ac.abort();
		};
		res.on('close', onClose);

		try {
			const result = await connection.chat(bridgeRequest);
			if (entry.ac.signal.aborted || res.writableEnded) {
				return;
			}
			if (result.error) {
				this._writeJsonError(res, 502, result.error, 'api_error');
				return;
			}
			if (body.stream === true) {
				res.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache',
					'Connection': 'keep-alive',
				});
				for (const frame of bridgeResultToResponsesSseFrames(result, bridgeRequest.modelId)) {
					res.write(frame);
				}
				res.end();
			} else {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(bridgeResultToResponsesBody(result, bridgeRequest.modelId));
			}
		} catch (err) {
			if (entry.ac.signal.aborted || res.writableEnded) {
				return;
			}
			const message = err instanceof Error ? err.message : String(err);
			if (!res.headersSent) {
				this._writeJsonError(res, 502, message, 'api_error');
			} else {
				try { res.end(); } catch { }
			}
		} finally {
			res.removeListener('close', onClose);
			runtime.inFlight.delete(entry);
		}
	}

	private _writeJsonError(res: http.ServerResponse, status: number, message: string, type = 'api_error'): void {
		if (res.headersSent || res.writableEnded) {
			return;
		}
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(responsesErrorBody(message, type));
	}
}

export class NullByokLmProxyService implements IByokLmProxyService {

	declare readonly _serviceBrand: undefined;

	start(): Promise<IByokLmProxyHandle> {
		return Promise.reject(new Error('BYOK is not supported in this agent host'));
	}

	dispose(): void {
	}
}
