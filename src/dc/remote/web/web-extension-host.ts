/**
 * Dardcor Code - Web Worker Based Extension Host Runtime For Browser (Task 827)
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { generateUuid } from '../../core/types/uuid';

export interface IWebExtensionHostOptions {
	readonly entryScript?: string;
	readonly name?: string;
}

const BOOTSTRAP_SCRIPT = `
self.onmessage = function (event) {
	var message = event.data;
	if (!message || typeof message.kind !== 'string') {
		return;
	}
	if (message.kind === 'initialize') {
		postMessage({ kind: 'ready', extensions: message.extensions || [] });
		return;
	}
	if (message.kind === 'invoke') {
		var result = { kind: 'response', id: message.id };
		try {
			result.result = (globalThis.dcExtensionApi && globalThis.dcExtensionApi[message.method])
				? globalThis.dcExtensionApi[message.method].apply(null, message.args || [])
				: undefined;
		} catch (error) {
			result.error = String(error && error.stack ? error.stack : error);
		}
		postMessage(result);
		return;
	}
	postMessage({ kind: 'event', event: message.event, data: message.data });
};
`;

export function createExtensionHostWorker(entryScript: string): Worker {
	if (typeof Worker === 'undefined') {
		throw new Error('Web Workers are not supported in this environment');
	}
	const blob = new Blob([`try { importScripts(${JSON.stringify(entryScript)}); } catch (error) { postMessage({ kind: 'error', error: String(error) }); }\n${BOOTSTRAP_SCRIPT}`], {
		type: 'application/javascript'
	});
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url);
	return worker;
}

export class WebExtensionHost extends Disposable {
	private _worker: Worker | null = null;
	private _ready = false;
	private _pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private _nextRequestId = 1;

	private readonly _onDidMessage = this._register(new Emitter<any>());
	readonly onDidMessage: Event<any> = this._onDidMessage.event;

	private readonly _onDidReady = this._register(new Emitter<{ extensions: string[] }>());
	readonly onDidReady: Event<{ extensions: string[] }> = this._onDidReady.event;

	private readonly _onDidExit = this._register(new Emitter<void>());
	readonly onDidExit: Event<void> = this._onDidExit.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	constructor(private readonly _options: IWebExtensionHostOptions = {}) {
		super();
	}

	get ready(): boolean {
		return this._ready && this._worker !== null;
	}

	start(extensions: string[] = []): void {
		if (this._worker) {
			return;
		}
		try {
			this._worker = this._options.entryScript
				? createExtensionHostWorker(this._options.entryScript)
				: this._createBootstrapWorker();
		} catch (error) {
			this._onDidError.fire(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		this._worker.onmessage = (event: MessageEvent) => this._handleMessage(event.data);
		this._worker.onerror = (event: ErrorEvent) => {
			this._onDidError.fire(new Error(event.message || 'Extension host worker error'));
		};
		this.postMessage({ kind: 'initialize', extensions });
	}

	stop(): void {
		if (this._worker) {
			this._worker.terminate();
			this._worker = null;
		}
		this._ready = false;
		for (const [, pending] of this._pending) {
			pending.reject(new Error('Extension host stopped'));
		}
		this._pending.clear();
	}

	postMessage(message: any): void {
		this._worker?.postMessage(message);
	}

	invoke(method: string, ...args: any[]): Promise<any> {
		const id = String(this._nextRequestId++);
		return new Promise<any>((resolvePromise, reject) => {
			this._pending.set(id, { resolve: resolvePromise, reject });
			this.postMessage({ kind: 'invoke', id, method, args });
		});
	}

	fireEvent(event: string, data?: any): void {
		this.postMessage({ kind: 'event', event, data });
	}

	private _handleMessage(message: any): void {
		if (!message || typeof message.kind !== 'string') {
			return;
		}
		switch (message.kind) {
			case 'ready':
				this._ready = true;
				this._onDidReady.fire({ extensions: Array.isArray(message.extensions) ? message.extensions : [] });
				return;
			case 'response': {
				const pending = this._pending.get(String(message.id));
				if (pending) {
					this._pending.delete(String(message.id));
					if (message.error) {
						pending.reject(new Error(message.error));
					} else {
						pending.resolve(message.result);
					}
				}
				return;
			}
			case 'event':
				this._onDidMessage.fire(message);
				return;
			case 'error':
				this._onDidError.fire(new Error(message.error));
				return;
			default:
				this._onDidMessage.fire(message);
		}
	}

	private _createBootstrapWorker(): Worker {
		if (typeof Blob === 'undefined') {
			throw new Error('Blob API not available');
		}
		const blob = new Blob([BOOTSTRAP_SCRIPT], { type: 'application/javascript' });
		const url = URL.createObjectURL(blob);
		return new Worker(url);
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
