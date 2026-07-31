/**
 * Dardcor Code - Async Emitter Architecture
 */

import { Emitter, Event } from './emitter';
import { IDisposable } from '../lifecycle/disposable';

export interface IWaitUntil {
	waitUntil(promise: Promise<any>): void;
}

export class AsyncEmitter<T extends IWaitUntil> {
	private readonly _emitter = new Emitter<T>();

	get event(): Event<T> {
		return this._emitter.event;
	}

	async fireAsync(eventFactory: (b: (promise: Promise<any>) => void) => T): Promise<void> {
		const promises: Promise<any>[] = [];
		const event = eventFactory(promise => {
			promises.push(promise);
		});

		this._emitter.fire(event);
		await Promise.all(promises);
	}

	dispose(): void {
		this._emitter.dispose();
	}
}
