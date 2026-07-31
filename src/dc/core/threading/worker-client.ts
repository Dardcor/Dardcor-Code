/**
 * Dardcor Code - Web Worker Thread Client Manager
 */

import { Disposable } from '../lifecycle/disposable.js';
import { Emitter, Event } from '../events/emitter.js';

export class WorkerClient extends Disposable {
	private _worker: Worker | null = null;
	private readonly _onMessage = this._register(new Emitter<any>());
	readonly onMessage: Event<any> = this._onMessage.event;

	constructor(workerUrl: string) {
		super();
		if (typeof Worker !== 'undefined') {
			this._worker = new Worker(workerUrl);
			this._worker.onmessage = e => {
				this._onMessage.fire(e.data);
			};
		}
	}

	postMessage(msg: any, transfer?: Transferable[]): void {
		if (this._worker) {
			this._worker.postMessage(msg, transfer || []);
		}
	}

	override dispose(): void {
		if (this._worker) {
			this._worker.terminate();
			this._worker = null;
		}
		super.dispose();
	}
}
