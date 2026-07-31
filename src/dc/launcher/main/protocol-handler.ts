import { app, protocol, net } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export const DEFAULT_PROTOCOLS = ['dc', 'dardcor'];

export type ProtocolRequestHandler = (request: GlobalRequest) => GlobalResponse | Promise<GlobalResponse>;

export class ProtocolManager extends Disposable {
	private readonly _schemes: string[] = [];
	private readonly _handlers = new Map<string, ProtocolRequestHandler>();

	public register(scheme: string, handler?: ProtocolRequestHandler): boolean {
		try {
			const registered = app.setAsDefaultProtocolClient(scheme);
			this._schemes.push(scheme);
			if (handler) {
				this._handlers.set(scheme, handler);
				protocol.handle(scheme, handler);
			}
			return registered;
		} catch (err) {
			console.warn(`[protocol-handler] failed to register '${scheme}':`, err);
			return false;
		}
	}

	public registerDefault(): boolean {
		let allOk = true;
		for (const scheme of DEFAULT_PROTOCOLS) {
			if (!this.register(scheme, this._defaultHandler)) {
				allOk = false;
			}
		}
		return allOk;
	}

	public unregister(scheme: string): void {
		try {
			protocol.unhandle(scheme);
		} catch {
			// Ignore.
		}
		const index = this._schemes.indexOf(scheme);
		if (index !== -1) {
			this._schemes.splice(index, 1);
		}
		this._handlers.delete(scheme);
	}

	public isRegistered(scheme: string): boolean {
		try {
			return app.isDefaultProtocolClient(scheme);
		} catch {
			return this._schemes.includes(scheme);
		}
	}

	public getProtocolHandlers(): string[] {
		return [...this._schemes];
	}

	public hasHandler(scheme: string): boolean {
		return this._handlers.has(scheme);
	}

	private readonly _defaultHandler: ProtocolRequestHandler = async (request) => {
		try {
			const url = new URL(request.url);
			const filePath = decodeURIComponent(url.pathname);
			if (url.hostname === 'auth') {
				return new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			if (filePath && !filePath.includes('..')) {
				const response = await net.fetch('file://' + filePath);
				return new Response(response.body, {
					status: response.status,
					headers: response.headers
				});
			}
			return new Response('Dardcor Code protocol handler', {
				status: 200,
				headers: { 'Content-Type': 'text/plain' }
			});
		} catch {
			return new Response('Bad Request', { status: 400 });
		}
	};

	public override dispose(): void {
		for (const scheme of [...this._schemes]) {
			this.unregister(scheme);
		}
		super.dispose();
	}
}

export function registerProtocolHandler(scheme: string, handler?: ProtocolRequestHandler): boolean {
	const manager = new ProtocolManager();
	return manager.register(scheme, handler);
}

export function registerDefaultProtocolHandlers(): boolean {
	const manager = new ProtocolManager();
	return manager.registerDefault();
}

export function getProtocolHandlers(): string[] {
	return [...DEFAULT_PROTOCOLS];
}

export function unregisterProtocolHandler(scheme: string): void {
	try {
		protocol.unhandle(scheme);
	} catch {
		// Ignore.
	}
}

export function isProtocolRegistered(scheme: string): boolean {
	try {
		return app.isDefaultProtocolClient(scheme);
	} catch {
		return false;
	}
}
