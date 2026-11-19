/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from './cancellation';
import { onUnexpectedError } from './errors';
import { DisposableStore, toDisposable } from './lifecycle';

export type ReadableStreamEventPayload<T> = T | Error | 'end';

export interface ReadableStreamEvents<T> {

	on(event: 'data', callback: (data: T) => void): void;

	on(event: 'error', callback: (err: Error) => void): void;

	on(event: 'end', callback: () => void): void;
}

export interface ReadableStream<T> extends ReadableStreamEvents<T> {

	pause(): void;

	resume(): void;

	destroy(): void;

	removeListener(event: string, callback: Function): void;
}

export interface Readable<T> {

	read(): T | null;
}

export function isReadable<T>(obj: unknown): obj is Readable<T> {
	const candidate = obj as Readable<T> | undefined;
	if (!candidate) {
		return false;
	}

	return typeof candidate.read === 'function';
}

export interface WriteableStream<T> extends ReadableStream<T> {

	write(data: T): void | Promise<void>;

	error(error: Error): void;

	end(result?: T): void;
}

export interface ReadableBufferedStream<T> {

	stream: ReadableStream<T>;

	buffer: T[];

	ended: boolean;
}

export function isReadableStream<T>(obj: unknown): obj is ReadableStream<T> {
	const candidate = obj as ReadableStream<T> | undefined;
	if (!candidate) {
		return false;
	}

	return [candidate.on, candidate.pause, candidate.resume, candidate.destroy].every(fn => typeof fn === 'function');
}

export function isReadableBufferedStream<T>(obj: unknown): obj is ReadableBufferedStream<T> {
	const candidate = obj as ReadableBufferedStream<T> | undefined;
	if (!candidate) {
		return false;
	}

	return isReadableStream(candidate.stream) && Array.isArray(candidate.buffer) && typeof candidate.ended === 'boolean';
}

export interface IReducer<T, R = T> {
	(data: T[]): R;
}

export interface IDataTransformer<Original, Transformed> {
	(data: Original): Transformed;
}

export interface IErrorTransformer {
	(error: Error): Error;
}

export interface ITransformer<Original, Transformed> {
	data: IDataTransformer<Original, Transformed>;
	error?: IErrorTransformer;
}

export function newWriteableStream<T>(reducer: IReducer<T> | null, options?: WriteableStreamOptions): WriteableStream<T> {
	return new WriteableStreamImpl<T>(reducer, options);
}

export interface WriteableStreamOptions {

	highWaterMark?: number;
}

class WriteableStreamImpl<T> implements WriteableStream<T> {

	private readonly state = {
		flowing: false,
		ended: false,
		destroyed: false
	};

	private readonly buffer = {
		data: [] as T[],
		error: [] as Error[]
	};

	private readonly listeners = {
		data: [] as { (data: T): void }[],
		error: [] as { (error: Error): void }[],
		end: [] as { (): void }[]
	};

	private readonly pendingWritePromises: Function[] = [];

	constructor(private reducer: IReducer<T> | null, private options?: WriteableStreamOptions) { }

	pause(): void {
		if (this.state.destroyed) {
			return;
		}

		this.state.flowing = false;
	}

	resume(): void {
		if (this.state.destroyed) {
			return;
		}

		if (!this.state.flowing) {
			this.state.flowing = true;

			this.flowData();
			this.flowErrors();
			this.flowEnd();
		}
	}

	write(data: T): void | Promise<void> {
		if (this.state.destroyed) {
			return;
		}

		if (this.state.flowing) {
			this.emitData(data);
		}

		else {
			this.buffer.data.push(data);

			if (typeof this.options?.highWaterMark === 'number' && this.buffer.data.length > this.options.highWaterMark) {
				return new Promise(resolve => this.pendingWritePromises.push(resolve));
			}
		}
	}

	error(error: Error): void {
		if (this.state.destroyed) {
			return;
		}

		if (this.state.flowing) {
			this.emitError(error);
		}

		else {
			this.buffer.error.push(error);
		}
	}

	end(result?: T): void {
		if (this.state.destroyed) {
			return;
		}

		if (typeof result !== 'undefined') {
			this.write(result);
		}

		if (this.state.flowing) {
			this.emitEnd();

			this.destroy();
		}

		else {
			this.state.ended = true;
		}
	}

	private emitData(data: T): void {
		this.listeners.data.slice(0).forEach(listener => listener(data));
	}

	private emitError(error: Error): void {
		if (this.listeners.error.length === 0) {
			onUnexpectedError(error);
		} else {
			this.listeners.error.slice(0).forEach(listener => listener(error));
		}
	}

	private emitEnd(): void {
		this.listeners.end.slice(0).forEach(listener => listener());
	}

	on(event: 'data', callback: (data: T) => void): void;
	on(event: 'error', callback: (err: Error) => void): void;
	on(event: 'end', callback: () => void): void;
	on(event: 'data' | 'error' | 'end', callback: ((data: T) => void) | ((err: Error) => void) | (() => void)): void {
		if (this.state.destroyed) {
			return;
		}

		switch (event) {
			case 'data':
				this.listeners.data.push(callback as (data: T) => void);

				this.resume();

				break;

			case 'end':
				this.listeners.end.push(callback as () => void);

				if (this.state.flowing && this.flowEnd()) {
					this.destroy();
				}

				break;

			case 'error':
				this.listeners.error.push(callback as (err: Error) => void);

				if (this.state.flowing) {
					this.flowErrors();
				}

				break;
		}
	}

	removeListener(event: string, callback: Function): void {
		if (this.state.destroyed) {
			return;
		}

		let listeners: unknown[] | undefined = undefined;

		switch (event) {
			case 'data':
				listeners = this.listeners.data;
				break;

			case 'end':
				listeners = this.listeners.end;
				break;

			case 'error':
				listeners = this.listeners.error;
				break;
		}

		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index >= 0) {
				listeners.splice(index, 1);
			}
		}
	}

	private flowData(): void {
		if (this.buffer.data.length === 0) {
			return;
		}

		if (typeof this.reducer === 'function') {
			const fullDataBuffer = this.reducer(this.buffer.data);

			this.emitData(fullDataBuffer);
		} else {
			for (const data of this.buffer.data) {
				this.emitData(data);
			}
		}

		this.buffer.data.length = 0;

		const pendingWritePromises = [...this.pendingWritePromises];
		this.pendingWritePromises.length = 0;
		pendingWritePromises.forEach(pendingWritePromise => pendingWritePromise());
	}

	private flowErrors(): void {
		if (this.listeners.error.length > 0) {
			for (const error of this.buffer.error) {
				this.emitError(error);
			}

			this.buffer.error.length = 0;
		}
	}

	private flowEnd(): boolean {
		if (this.state.ended) {
			this.emitEnd();

			return this.listeners.end.length > 0;
		}

		return false;
	}

	destroy(): void {
		if (!this.state.destroyed) {
			this.state.destroyed = true;
			this.state.ended = true;

			this.buffer.data.length = 0;
			this.buffer.error.length = 0;

			this.listeners.data.length = 0;
			this.listeners.error.length = 0;
			this.listeners.end.length = 0;

			this.pendingWritePromises.length = 0;
		}
	}
}

export function consumeReadable<T>(readable: Readable<T>, reducer: IReducer<T>): T {
	const chunks: T[] = [];

	let chunk: T | null;
	while ((chunk = readable.read()) !== null) {
		chunks.push(chunk);
	}

	return reducer(chunks);
}

export function peekReadable<T>(readable: Readable<T>, reducer: IReducer<T>, maxChunks: number): T | Readable<T> {
	const chunks: T[] = [];

	let chunk: T | null | undefined = undefined;
	while ((chunk = readable.read()) !== null && chunks.length < maxChunks) {
		chunks.push(chunk);
	}

	if (chunk === null && chunks.length > 0) {
		return reducer(chunks);
	}

	return {
		read: () => {

			if (chunks.length > 0) {
				return chunks.shift()!;
			}

			if (typeof chunk !== 'undefined') {
				const lastReadChunk = chunk;

				chunk = undefined;

				return lastReadChunk;
			}

			return readable.read();
		}
	};
}

export function consumeStream<T, R = T>(stream: ReadableStreamEvents<T>, reducer: IReducer<T, R>): Promise<R>;
export function consumeStream(stream: ReadableStreamEvents<unknown>): Promise<undefined>;
export function consumeStream<T, R = T>(stream: ReadableStreamEvents<T>, reducer?: IReducer<T, R>): Promise<R | undefined> {
	return new Promise((resolve, reject) => {
		const chunks: T[] = [];

		listenStream(stream, {
			onData: chunk => {
				if (reducer) {
					chunks.push(chunk);
				}
			},
			onError: error => {
				if (reducer) {
					reject(error);
				} else {
					resolve(undefined);
				}
			},
			onEnd: () => {
				if (reducer) {
					resolve(reducer(chunks));
				} else {
					resolve(undefined);
				}
			}
		});
	});
}

export interface IStreamListener<T> {

	onData(data: T): void;

	onError(err: Error): void;

	onEnd(): void;
}

export function listenStream<T>(stream: ReadableStreamEvents<T>, listener: IStreamListener<T>, token?: CancellationToken): void {

	stream.on('error', error => {
		if (!token?.isCancellationRequested) {
			listener.onError(error);
		}
	});

	stream.on('end', () => {
		if (!token?.isCancellationRequested) {
			listener.onEnd();
		}
	});

	stream.on('data', data => {
		if (!token?.isCancellationRequested) {
			listener.onData(data);
		}
	});
}

export function peekStream<T>(stream: ReadableStream<T>, maxChunks: number): Promise<ReadableBufferedStream<T>> {
	return new Promise((resolve, reject) => {
		const streamListeners = new DisposableStore();
		const buffer: T[] = [];

		const dataListener = (chunk: T) => {

			buffer.push(chunk);

			if (buffer.length > maxChunks) {

				streamListeners.dispose();
				stream.pause();

				return resolve({ stream, buffer, ended: false });
			}
		};

		const errorListener = (error: Error) => {
			streamListeners.dispose();

			return reject(error);
		};

		const endListener = () => {
			streamListeners.dispose();

			return resolve({ stream, buffer, ended: true });
		};

		streamListeners.add(toDisposable(() => stream.removeListener('error', errorListener)));
		stream.on('error', errorListener);

		streamListeners.add(toDisposable(() => stream.removeListener('end', endListener)));
		stream.on('end', endListener);

		streamListeners.add(toDisposable(() => stream.removeListener('data', dataListener)));
		stream.on('data', dataListener);
	});
}

export function toStream<T>(t: T, reducer: IReducer<T>): ReadableStream<T> {
	const stream = newWriteableStream<T>(reducer);

	stream.end(t);

	return stream;
}

export function emptyStream(): ReadableStream<never> {
	const stream = newWriteableStream<never>(() => { throw new Error('not supported'); });
	stream.end();

	return stream;
}

export function toReadable<T>(t: T): Readable<T> {
	let consumed = false;

	return {
		read: () => {
			if (consumed) {
				return null;
			}

			consumed = true;

			return t;
		}
	};
}

export function transform<Original, Transformed>(stream: ReadableStreamEvents<Original>, transformer: ITransformer<Original, Transformed>, reducer: IReducer<Transformed>): ReadableStream<Transformed> {
	const target = newWriteableStream<Transformed>(reducer);

	listenStream(stream, {
		onData: data => target.write(transformer.data(data)),
		onError: error => target.error(transformer.error ? transformer.error(error) : error),
		onEnd: () => target.end()
	});

	return target;
}

export function prefixedReadable<T>(prefix: T, readable: Readable<T>, reducer: IReducer<T>): Readable<T> {
	let prefixHandled = false;

	return {
		read: () => {
			const chunk = readable.read();

			if (!prefixHandled) {
				prefixHandled = true;

				if (chunk !== null) {
					return reducer([prefix, chunk]);
				}

				return prefix;
			}

			return chunk;
		}
	};
}

export function prefixedStream<T>(prefix: T, stream: ReadableStream<T>, reducer: IReducer<T>): ReadableStream<T> {
	let prefixHandled = false;

	const target = newWriteableStream<T>(reducer);

	listenStream(stream, {
		onData: data => {

			if (!prefixHandled) {
				prefixHandled = true;

				return target.write(reducer([prefix, data]));
			}

			return target.write(data);
		},
		onError: error => target.error(error),
		onEnd: () => {

			if (!prefixHandled) {
				prefixHandled = true;

				target.write(prefix);
			}

			target.end();
		}
	});

	return target;
}
