/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AddressInfo } from 'net';
import type * as http from 'http';
import { IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../log/common/log.js';
import { decodeExportTraceRequest, IDecodeResult } from './otlpJsonDecode.js';
import { IOtlpExportTraceServiceRequest, IOtlpExportTraceServiceResponse } from './otlpJsonTypes.js';

export const OTLP_TRACES_PATH = '/v1/traces';

const DEFAULT_MAX_BODY_BYTES = 64 * 1024 * 1024;

export interface IOtlpReceiverHandlers {
	transformBody?(body: Buffer): Buffer;
	onSpans(result: IDecodeResult): void;
	onForward?(body: Buffer, contentType: string): void;
}

export interface IOtlpReceiverOptions {
	readonly maxBodyBytes?: number;
}

export interface ILocalOtlpHttpReceiver extends IDisposable {
	readonly baseUrl: string;
	readonly port: number;
}

export async function startLocalOtlpHttpReceiver(
	handlers: IOtlpReceiverHandlers,
	logService: ILogService,
	options: IOtlpReceiverOptions = {},
): Promise<ILocalOtlpHttpReceiver> {
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
	const httpModule = await import('http');
	const server = httpModule.createServer();

	server.on('request', (req, res) => {
		handleRequest(req, res, handlers, logService, maxBodyBytes).catch(err => {
			logService.error(`[agentHost-otel] receiver: unhandled error: ${err instanceof Error ? err.message : String(err)}`);
			if (!res.headersSent) {
				writePlain(res, 500, 'internal error');
			} else if (!res.writableEnded) {
				try { res.end(); } catch { }
			}
		});
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (err: Error) => reject(err);
		server.once('error', onError);
		server.listen(0, '127.0.0.1', () => {
			server.removeListener('error', onError);
			resolve();
		});
	});

	const address = server.address();
	if (!address || typeof address === 'string') {
		server.close();
		throw new Error(`local OTLP receiver failed to bind: unexpected address ${String(address)}`);
	}
	const port = (address as AddressInfo).port;
	const baseUrl = `http://127.0.0.1:${port}`;
	logService.info(`[agentHost-otel] receiver listening on ${baseUrl}`);

	const disposable = toDisposable(() => {
		server.closeAllConnections();
		server.close(err => {
			if (err) {
				logService.warn(`[agentHost-otel] receiver close error: ${err.message}`);
			}
		});
	});

	return Object.assign(disposable, { baseUrl, port });
}

async function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	handlers: IOtlpReceiverHandlers,
	logService: ILogService,
	maxBodyBytes: number,
): Promise<void> {
	const url = req.url ?? '';
	const pathname = url.split('?', 1)[0];
	if (pathname !== OTLP_TRACES_PATH) {
		writePlain(res, 404, 'not found');
		return;
	}
	if (req.method !== 'POST') {
		res.setHeader('allow', 'POST');
		writePlain(res, 405, 'method not allowed');
		return;
	}

	const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
	if (!contentType.includes('application/json')) {
		writePlain(res, 415, 'unsupported content-type; this receiver only accepts application/json');
		return;
	}

	const encoding = (req.headers['content-encoding'] ?? '').toString().toLowerCase();
	if (encoding && encoding !== 'identity') {
		writePlain(res, 415, `unsupported content-encoding: ${encoding}`);
		return;
	}

	let body: Buffer;
	try {
		body = await readBody(req, maxBodyBytes);
	} catch (err) {
		if (err instanceof PayloadTooLargeError) {
			writePlain(res, 413, 'payload too large');
		} else {
			writePlain(res, 400, 'failed to read body');
		}
		return;
	}

	if (handlers.transformBody) {
		try {
			body = handlers.transformBody(body);
		} catch (err) {
			logService.warn(`[agentHost-otel] transform callback threw: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (handlers.onForward) {
		try {
			handlers.onForward(body, contentType);
		} catch (err) {
			logService.warn(`[agentHost-otel] forward callback threw: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	let parsed: IOtlpExportTraceServiceRequest;
	try {
		parsed = JSON.parse(body.toString('utf8')) as IOtlpExportTraceServiceRequest;
	} catch (err) {
		writePlain(res, 400, `invalid json: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	const result = decodeExportTraceRequest(parsed);
	try {
		handlers.onSpans(result);
	} catch (err) {
		logService.warn(`[agentHost-otel] onSpans handler threw: ${err instanceof Error ? err.message : String(err)}`);
	}

	const responseBody: IOtlpExportTraceServiceResponse = result.rejected > 0
		? { partialSuccess: { rejectedSpans: result.rejected, errorMessage: result.errors.join('; ').slice(0, 1024) } }
		: {};
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json');
	res.end(JSON.stringify(responseBody));
}

class PayloadTooLargeError extends Error { }

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let received = 0;
		const onData = (chunk: Buffer) => {
			received += chunk.length;
			if (received > maxBytes) {
				cleanup();
				reject(new PayloadTooLargeError(`body exceeds ${maxBytes} bytes`));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => {
			cleanup();
			resolve(Buffer.concat(chunks));
		};
		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};
		const cleanup = () => {
			req.removeListener('data', onData);
			req.removeListener('end', onEnd);
			req.removeListener('error', onError);
		};
		req.on('data', onData);
		req.on('end', onEnd);
		req.on('error', onError);
	});
}

function writePlain(res: http.ServerResponse, status: number, message: string): void {
	res.statusCode = status;
	res.setHeader('content-type', 'text/plain; charset=utf-8');
	res.end(message);
}
