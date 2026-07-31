/**
 * Dardcor Code - Readable & Writable Streaming Buffers
 */

import { Emitter, Event } from '../events/emitter';
import { DataBuffer } from './buffer';

export interface ReadableStream<T> {
	on(event: 'data', listener: (data: T) => void): void;
	on(event: 'end', listener: () => void): void;
	on(event: 'error', listener: (err: any) => void): void;
}

export class BufferStream {
	private readonly _onData = new Emitter<DataBuffer>();
	readonly onData: Event<DataBuffer> = this._onData.event;

	private readonly _onEnd = new Emitter<void>();
	readonly onEnd: Event<void> = this._onEnd.event;

	write(data: DataBuffer): void {
		this._onData.fire(data);
	}

	end(): void {
		this._onEnd.fire();
	}
}
