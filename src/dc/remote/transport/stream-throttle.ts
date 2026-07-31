import { Transform, TransformCallback } from 'node:stream';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IStreamThrottleOptions {
	readonly bytesPerSecond?: number;
	readonly chunkSize?: number;
	readonly autoStart?: boolean;
}

export class StreamThrottle extends Transform {
	private _bytesPerSecond: number;
	private readonly _chunkSize: number;

	private _queue: Buffer[] = [];
	private _queuedBytes = 0;
	private _windowStart = 0;
	private _windowBytes = 0;
	private _isStarted: boolean;
	private _timer: ReturnType<typeof setTimeout> | null = null;

	private _totalIn = 0;
	private _totalOut = 0;
	private _samples: number[] = [];

	private readonly _onThroughput = new Emitter<number>();
	readonly onThroughput: Event<number> = this._onThroughput.event;

	private readonly _onPause = new Emitter<void>();
	readonly onPause: Event<void> = this._onPause.event;

	private readonly _onResume = new Emitter<void>();
	readonly onResume: Event<void> = this._onResume.event;

	constructor(options: IStreamThrottleOptions = {}) {
		super();
		this._bytesPerSecond = options.bytesPerSecond ?? 1024 * 1024;
		this._chunkSize = options.chunkSize ?? 64 * 1024;
		this._isStarted = options.autoStart ?? true;
		if (this._isStarted) {
			this._windowStart = Date.now();
		}
	}

	get isStarted(): boolean {
		return this._isStarted;
	}

	get bytesPerSecond(): number {
		return this._bytesPerSecond;
	}

	setRate(bps: number): void {
		this._bytesPerSecond = Math.max(1, Math.round(bps));
		this._windowStart = Date.now();
		this._windowBytes = 0;
	}

	start(): void {
		if (this._isStarted) {
			return;
		}
		this._isStarted = true;
		this._windowStart = Date.now();
		this._windowBytes = 0;
		this._onResume.fire();
	}

	stop(): void {
		if (!this._isStarted) {
			return;
		}
		this._isStarted = false;
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		this._onPause.fire();
	}

	pause(): this {
		this.stop();
		return this;
	}

	resume(): this {
		this.start();
		return this;
	}

	throttle(chunk: Buffer): void {
		this._queue.push(chunk);
		this._queuedBytes += chunk.length;
		this._pump();
	}

	getThroughput(): number {
		if (this._samples.length === 0) {
			return 0;
		}
		const sum = this._samples.reduce((total, sample) => total + sample, 0);
		return Math.round(sum / this._samples.length);
	}

	getStats(): { bytesIn: number; bytesOut: number; queuedBytes: number; throughput: number } {
		return {
			bytesIn: this._totalIn,
			bytesOut: this._totalOut,
			queuedBytes: this._queuedBytes,
			throughput: this.getThroughput()
		};
	}

	flushQueue(): void {
		this._pump();
	}

	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		this._totalIn += chunk.length;
		this.throttle(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		callback();
	}

	override _flush(callback: TransformCallback): void {
		const flush = (): void => {
			if (this._queuedBytes > 0) {
				this._pump();
				setTimeout(flush, 10);
				return;
			}
			if (this._timer) {
				clearTimeout(this._timer);
				this._timer = null;
			}
			callback();
		};
		flush();
	}

	private _pump(): void {
		if (this._timer) {
			return;
		}
		if (!this._isStarted || this._queuedBytes === 0) {
			return;
		}
		const now = Date.now();
		if (this._windowStart === 0) {
			this._windowStart = now;
		}
		const windowMs = 1000;
		const elapsed = Math.max(1, now - this._windowStart);
		if (elapsed >= windowMs) {
			this._recordThroughput(this._windowBytes);
			this._windowStart = now;
			this._windowBytes = 0;
		}
		const budget = this._bytesPerSecond * (elapsed / 1000);
		if (this._windowBytes >= budget) {
			const waitMs = Math.max(1, Math.ceil(((this._windowBytes - budget) / this._bytesPerSecond) * 1000));
			this._timer = setTimeout(() => {
				this._timer = null;
				this._pump();
			}, waitMs);
			return;
		}
		const available = Math.min(this._chunkSize, this._queuedBytes);
		const chunk = this._queue[0];
		if (chunk.length <= available) {
			this._queue.shift();
		} else {
			this._queue[0] = chunk.subarray(available);
		}
		const send = chunk.subarray(0, available);
		this._queuedBytes -= available;
		this._windowBytes += available;
		this._totalOut += available;
		this.push(send);
		if (this._queuedBytes > 0) {
			setImmediate(() => this._pump());
		}
	}

	private _recordThroughput(bytes: number): void {
		this._samples.push(bytes);
		if (this._samples.length > 30) {
			this._samples.shift();
		}
		this._onThroughput.fire(bytes);
	}
}
