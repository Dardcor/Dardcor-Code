/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as http from 'http';
import { AddressInfo } from 'net';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../log/common/log.js';


export interface IProxyInFlight {
	readonly ac: AbortController;
	readonly res: http.ServerResponse;
	clientGone: boolean;
}

export interface ILoopbackProxyRuntime<TState> {
	readonly baseUrl: string;
	readonly nonce: string;
	readonly inFlight: Set<IProxyInFlight>;
	readonly state: TState;
}

export interface ILoopbackProxyHandle extends IDisposable {
	readonly baseUrl: string;
	readonly nonce: string;
}



interface IInternalRuntime<TState> extends ILoopbackProxyRuntime<TState> {
	readonly server: http.Server;
	refcount: number;
}

function generateNonce(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, '0');
	}
	return out;
}


export function readProxyRequestBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

export abstract class LoopbackProxyServer<TState, TSeed = void> {

	private _runtime: IInternalRuntime<TState> | undefined;
	private _starting: Promise<IInternalRuntime<TState>> | undefined;
	private _disposed = false;

	constructor(
		protected readonly name: string,
		protected readonly _logService: ILogService,
	) { }

	protected get isDisposed(): boolean {
		return this._disposed;
	}

	protected abstract createState(seed: TSeed): TState;

	protected abstract handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		runtime: ILoopbackProxyRuntime<TState>,
	): Promise<void>;

	protected writeInternalError(res: http.ServerResponse): void {
		res.writeHead(500, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ error: { type: 'api_error', message: 'Internal proxy error' } }));
	}

	protected async acquire(seed: TSeed): Promise<{ runtime: ILoopbackProxyRuntime<TState>; release: () => void }> {
		if (this._disposed) {
			throw new Error(`${this.name} has been disposed`);
		}
		const runtime = await this._ensureRuntime(seed);
		if (this._disposed || this._runtime !== runtime) {
			throw new Error(`${this.name} has been disposed`);
		}
		runtime.refcount++;

		let released = false;
		const release = () => {
			if (released) {
				return;
			}
			released = true;
			this._releaseHandle(runtime);
		};
		return { runtime, release };
	}

	dispose(): void {
		if (this._disposed) {
			return;
		}
		this._disposed = true;
		this._teardownRuntime();
	}

	private _ensureRuntime(seed: TSeed): Promise<IInternalRuntime<TState>> {
		if (this._runtime) {
			return Promise.resolve(this._runtime);
		}
		if (!this._starting) {
			this._starting = (async () => {
				try {
					const rt = await this._startServer(seed);
					if (this._disposed) {
						rt.server.closeAllConnections();
						rt.server.close();
						throw new Error(`${this.name} has been disposed`);
					}
					this._runtime = rt;
					return rt;
				} finally {
					this._starting = undefined;
				}
			})();
		}
		return this._starting;
	}

	private _releaseHandle(runtime: IInternalRuntime<TState>): void {
		if (this._runtime !== runtime) {
			return;
		}
		runtime.refcount--;
		if (runtime.refcount === 0) {
			this._teardownRuntime();
		}
	}

	private _teardownRuntime(): void {
		const runtime = this._runtime;
		if (!runtime) {
			return;
		}
		this._runtime = undefined;
		for (const entry of runtime.inFlight) {
			entry.ac.abort();
		}
		runtime.server.closeAllConnections();
		runtime.server.close(err => {
			if (err) {
				this._logService.warn(`[${this.name}] server.close error: ${err.message}`);
			}
		});
	}

	private async _startServer(seed: TSeed): Promise<IInternalRuntime<TState>> {
		const nonce = generateNonce();
		const inFlight = new Set<IProxyInFlight>();
		const httpModule = await import('http');
		const server = httpModule.createServer();

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
			throw new Error(`${this.name} failed to bind: unexpected address ${String(address)}`);
		}
		const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
		this._logService.info(`[${this.name}] listening on ${baseUrl}`);

		const runtime: IInternalRuntime<TState> = {
			server,
			baseUrl,
			nonce,
			inFlight,
			refcount: 0,
			state: this.createState(seed),
		};

		server.on('request', (req, res) => {
			this.handleRequest(req, res, runtime).catch(err => {
				this._logService.error(`[${this.name}] unhandled request error: ${err instanceof Error ? err.message : String(err)}`);
				if (!res.headersSent) {
					try {
						this.writeInternalError(res);
					} catch {
					}
				} else if (!res.writableEnded) {
					try {
						res.end();
					} catch { }
				}
			});
		});

		return runtime;
	}
}
