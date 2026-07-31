/**
 * Dardcor Code - DataBuffer Abstraction
 */

export class DataBuffer {
	readonly buffer: Uint8Array;

	private constructor(buffer: Uint8Array) {
		this.buffer = buffer;
	}

	static wrap(buffer: Uint8Array): DataBuffer {
		return new DataBuffer(buffer);
	}

	static fromString(source: string): DataBuffer {
		const encoder = new TextEncoder();
		return new DataBuffer(encoder.encode(source));
	}

	static concat(buffers: DataBuffer[]): DataBuffer {
		let totalLength = 0;
		for (const b of buffers) {
			totalLength += b.byteLength;
		}
		const res = new Uint8Array(totalLength);
		let offset = 0;
		for (const b of buffers) {
			res.set(b.buffer, offset);
			offset += b.byteLength;
		}
		return new DataBuffer(res);
	}

	get byteLength(): number {
		return this.buffer.byteLength;
	}

	toString(): string {
		const decoder = new TextDecoder('utf-8');
		return decoder.decode(this.buffer);
	}
}
