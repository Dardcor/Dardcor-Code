/**
 * Dardcor Code - Framed Binary Frame Message Encoder & Decoder (Task 823)
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export const FRAME_HEADER_SIZE = 4;
export const DEFAULT_MAX_FRAME_SIZE = 16 * 1024 * 1024;

export function readUInt32BE(buffer: Uint8Array, offset: number): number {
	return (buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3];
}

export function writeUInt32BE(value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	bytes[0] = (value >>> 24) & 0xff;
	bytes[1] = (value >>> 16) & 0xff;
	bytes[2] = (value >>> 8) & 0xff;
	bytes[3] = value & 0xff;
	return bytes;
}

export function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const buffer of buffers) {
		total += buffer.byteLength;
	}
	const result = new Uint8Array(total);
	let offset = 0;
	for (const buffer of buffers) {
		result.set(buffer, offset);
		offset += buffer.byteLength;
	}
	return result;
}

export function encodeFrame(payload: Uint8Array | string): Uint8Array {
	const data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
	const header = writeUInt32BE(data.byteLength);
	return concatBuffers(header, data);
}

export function decodeFrame(frame: Uint8Array): Uint8Array {
	if (frame.byteLength < FRAME_HEADER_SIZE) {
		throw new Error(`Invalid frame: expected at least ${FRAME_HEADER_SIZE} bytes, got ${frame.byteLength}`);
	}
	const length = readUInt32BE(frame, 0);
	if (frame.byteLength < FRAME_HEADER_SIZE + length) {
		throw new Error(`Invalid frame: expected ${length} payload bytes, got ${frame.byteLength - FRAME_HEADER_SIZE}`);
	}
	return frame.subarray(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + length);
}

export interface IFrameDecoderOptions {
	readonly maxFrameSize?: number;
}

export class FrameDecoder extends Disposable {
	private _buffer: Uint8Array = new Uint8Array(0);
	private _bytesBuffered = 0;

	private readonly _onFrame = this._register(new Emitter<Uint8Array>());
	readonly onFrame: Event<Uint8Array> = this._onFrame.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(private readonly _options: IFrameDecoderOptions = {}) {
		super();
	}

	get maxFrameSize(): number {
		return this._options.maxFrameSize ?? DEFAULT_MAX_FRAME_SIZE;
	}

	get bytesBuffered(): number {
		return this._bytesBuffered;
	}

	push(chunk: Uint8Array): void {
		if (chunk.byteLength === 0) {
			return;
		}
		this._buffer = concatBuffers(this._buffer, chunk);
		this._bytesBuffered += chunk.byteLength;

		while (this._buffer.byteLength >= FRAME_HEADER_SIZE) {
			const length = readUInt32BE(this._buffer, 0);
			if (length > this.maxFrameSize) {
				const error = new Error(`Frame of ${length} bytes exceeds max frame size of ${this.maxFrameSize}`);
				this._onError.fire(error);
				this.reset();
				return;
			}
			if (this._buffer.byteLength < FRAME_HEADER_SIZE + length) {
				break;
			}
			const frame = this._buffer.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + length);
			this._buffer = this._buffer.subarray(FRAME_HEADER_SIZE + length);
			this._bytesBuffered = this._buffer.byteLength;
			this._onFrame.fire(frame);
		}
	}

	reset(): void {
		this._buffer = new Uint8Array(0);
		this._bytesBuffered = 0;
	}
}
