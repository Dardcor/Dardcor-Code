/**
 * Dardcor Code - Request Service (Task 144)
 * Mirrors: vs/platform/request/common/request.ts (HTTP proxy & network fetch provider)
 */

import { createDecorator } from '../instantiation/annotations';
import { CancellationToken } from '../../core/async/cancellation';
import { IProxyConfiguration, resolveProxyURL } from './proxy-agent';

export interface IRequestContext {
	status: number;
	headers: Record<string, string>;
	text(): Promise<string>;
	arrayBuffer(): Promise<ArrayBuffer>;
	stream(): ReadableStream<Uint8Array> | null;
}

export interface IRequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeout?: number;
	proxy?: IProxyConfiguration;
}

export const IRequestService = createDecorator<IRequestService>('requestService');

export interface IRequestService {
	readonly _serviceBrand: undefined;
	request(options: IRequestOptions, token?: CancellationToken): Promise<IRequestContext>;
}

export class RequestService implements IRequestService {
	declare readonly _serviceBrand: undefined;

	async request(options: IRequestOptions, token?: CancellationToken): Promise<IRequestContext> {
		if (options.proxy) {
			const proxyUrl = resolveProxyURL(options.url, options.proxy);
			if (proxyUrl) {
				const viaProxy = await this._requestViaNodeProxy(options, proxyUrl, token);
				if (viaProxy) {
					return viaProxy;
				}
			}
		}
		return this._requestViaFetch(options, token);
	}

	private async _requestViaFetch(options: IRequestOptions, token?: CancellationToken): Promise<IRequestContext> {
		const controller = new AbortController();
		const timers: ReturnType<typeof setTimeout>[] = [];
		if (options.timeout) {
			timers.push(setTimeout(() => controller.abort(), options.timeout));
		}
		const onCancel = token?.onCancellationRequested(() => controller.abort());
		if (token?.isCancellationRequested) {
			controller.abort();
		}
		try {
			const res = await fetch(options.url, {
				method: options.method ?? 'GET',
				headers: options.headers,
				body: options.body,
				signal: controller.signal,
			});
			const headersRecord: Record<string, string> = {};
			res.headers.forEach((value, key) => {
				headersRecord[key.toLowerCase()] = value;
			});
			return {
				status: res.status,
				headers: headersRecord,
				text: () => res.text(),
				arrayBuffer: () => res.arrayBuffer(),
				stream: () => (res.body ? (res.body as ReadableStream<Uint8Array>) : null),
			};
		} finally {
			for (const t of timers) {
				clearTimeout(t);
			}
			onCancel?.dispose();
		}
	}

	private async _requestViaNodeProxy(options: IRequestOptions, proxyUrl: string, token?: CancellationToken): Promise<IRequestContext | null> {
		try {
			const isHttps = proxyUrl.startsWith('https:');
			const mod = isHttps ? await import('node:https') : await import('node:http');
			const target = new URL(options.url);
			const proxy = new URL(proxyUrl);
			const body = options.body ?? '';
			const result = await new Promise<{ status: number; headers: Record<string, string>; buffer: ArrayBuffer }>((resolve, reject) => {
				const req = mod.request({
					host: proxy.hostname,
					port: proxy.port ? Number(proxy.port) : (isHttps ? 443 : 80),
					method: options.method ?? 'GET',
					path: options.url,
					headers: {
						...options.headers,
						Host: target.host,
						'Content-Length': Buffer.byteLength(body),
					},
				}, (res: any) => {
					const chunks: Buffer[] = [];
					res.on('data', (chunk: Buffer) => chunks.push(chunk));
					res.on('end', () => {
						const full = Buffer.concat(chunks);
						const arrayBuffer = full.buffer.slice(full.byteOffset, full.byteOffset + full.byteLength) as ArrayBuffer;
						const headersRecord: Record<string, string> = {};
						for (const [key, value] of Object.entries(res.headers)) {
							headersRecord[key.toLowerCase()] = String(value);
						}
						resolve({ status: res.statusCode ?? 0, headers: headersRecord, buffer: arrayBuffer });
					});
				});
				req.on('error', reject);
				const onCancel = token?.onCancellationRequested(() => req.destroy());
				if (token?.isCancellationRequested) {
					req.destroy();
				}
				if (body) {
					req.write(body);
				}
				req.end();
				req.on('close', () => onCancel?.dispose());
			});
			return {
				status: result.status,
				headers: result.headers,
				text: async () => new TextDecoder().decode(result.buffer),
				arrayBuffer: async () => result.buffer,
				stream: () => null,
			};
		} catch {
			return null;
		}
	}
}
