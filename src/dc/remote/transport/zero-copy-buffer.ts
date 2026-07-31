export interface IZeroCopyOptions {
	readonly byteOffset?: number;
	readonly byteLength?: number;
}

export class ZeroCopyBuffer {
	private readonly _buffer: ArrayBuffer;
	private readonly _view: DataView;
	private readonly _byteOffset: number;
	private readonly _byteLength: number;

	constructor(buffer: ArrayBuffer, options: IZeroCopyOptions = {}) {
		const byteOffset = options.byteOffset ?? 0;
		const byteLength = options.byteLength ?? buffer.byteLength - byteOffset;
		if (byteOffset < 0 || byteOffset > buffer.byteLength) {
			throw new RangeError(`Invalid byteOffset ${byteOffset} for buffer of ${buffer.byteLength} bytes`);
		}
		if (byteLength < 0 || byteOffset + byteLength > buffer.byteLength) {
			throw new RangeError(`Invalid byteLength ${byteLength} for buffer of ${buffer.byteLength} bytes at offset ${byteOffset}`);
		}
		this._buffer = buffer;
		this._byteOffset = byteOffset;
		this._byteLength = byteLength;
		this._view = new DataView(buffer, byteOffset, byteLength);
	}

	static wrap(buffer: ArrayBuffer): ZeroCopyBuffer {
		return new ZeroCopyBuffer(buffer);
	}

	static fromBytes(bytes: Uint8Array): ZeroCopyBuffer {
		return new ZeroCopyBuffer(bytes.buffer, {
			byteOffset: bytes.byteOffset,
			byteLength: bytes.byteLength
		});
	}

	get byteLength(): number {
		return this._byteLength;
	}

	get byteOffset(): number {
		return this._byteOffset;
	}

	get underlyingBuffer(): ArrayBuffer {
		return this._buffer;
	}

	slice(start: number, end?: number): ZeroCopyBuffer {
		const resolvedStart = start < 0 ? Math.max(0, this._byteLength + start) : start;
		const resolvedEnd = end === undefined ? this._byteLength : (end < 0 ? this._byteLength + end : end);
		if (resolvedStart < 0 || resolvedStart > this._byteLength || resolvedEnd < resolvedStart || resolvedEnd > this._byteLength) {
			throw new RangeError(`Invalid slice [${resolvedStart}, ${resolvedEnd}) for buffer of ${this._byteLength} bytes`);
		}
		return new ZeroCopyBuffer(this._buffer, {
			byteOffset: this._byteOffset + resolvedStart,
			byteLength: resolvedEnd - resolvedStart
		});
	}

	subview(): Uint8Array {
		return new Uint8Array(this._buffer, this._byteOffset, this._byteLength);
	}

	getUint8(offset: number): number {
		return this._view.getUint8(offset);
	}

	getUint16(offset: number, littleEndian = false): number {
		return this._view.getUint16(offset, littleEndian);
	}

	getUint32(offset: number, littleEndian = false): number {
		return this._view.getUint32(offset, littleEndian);
	}

	getInt8(offset: number): number {
		return this._view.getInt8(offset);
	}

	getInt16(offset: number, littleEndian = false): number {
		return this._view.getInt16(offset, littleEndian);
	}

	getInt32(offset: number, littleEndian = false): number {
		return this._view.getInt32(offset, littleEndian);
	}

	getFloat32(offset: number, littleEndian = false): number {
		return this._view.getFloat32(offset, littleEndian);
	}

	getFloat64(offset: number, littleEndian = false): number {
		return this._view.getFloat64(offset, littleEndian);
	}

	getBytes(offset: number, length: number): Uint8Array {
		this._checkRange(offset, length);
		return new Uint8Array(this._buffer, this._byteOffset + offset, length);
	}

	writeUint8(offset: number, value: number): void {
		this._view.setUint8(offset, value);
	}

	writeUint16(offset: number, value: number, littleEndian = false): void {
		this._view.setUint16(offset, value, littleEndian);
	}

	writeUint32(offset: number, value: number, littleEndian = false): void {
		this._view.setUint32(offset, value, littleEndian);
	}

	writeInt8(offset: number, value: number): void {
		this._view.setInt8(offset, value);
	}

	writeInt16(offset: number, value: number, littleEndian = false): void {
		this._view.setInt16(offset, value, littleEndian);
	}

	writeInt32(offset: number, value: number, littleEndian = false): void {
		this._view.setInt32(offset, value, littleEndian);
	}

	writeFloat32(offset: number, value: number, littleEndian = false): void {
		this._view.setFloat32(offset, value, littleEndian);
	}

	writeFloat64(offset: number, value: number, littleEndian = false): void {
		this._view.setFloat64(offset, value, littleEndian);
	}

	writeBytes(offset: number, bytes: Uint8Array): void {
		this._checkRange(offset, bytes.byteLength);
		new Uint8Array(this._buffer, this._byteOffset + offset, bytes.byteLength).set(bytes);
	}

	toArrayBuffer(): ArrayBuffer {
		return this._buffer.slice(this._byteOffset, this._byteOffset + this._byteLength);
	}

	createReader(littleEndian = false): ZeroCopyReader {
		return new ZeroCopyReader(this, littleEndian);
	}

	createWriter(littleEndian = false): ZeroCopyWriter {
		return new ZeroCopyWriter(this, littleEndian);
	}

	private _checkRange(offset: number, length: number): void {
		if (offset < 0 || length < 0 || offset + length > this._byteLength) {
			throw new RangeError(`Access out of bounds: offset ${offset}, length ${length}, size ${this._byteLength}`);
		}
	}
}

export class ZeroCopyReader {
	private _offset = 0;

	constructor(
		private readonly _buffer: ZeroCopyBuffer,
		private readonly _littleEndian = false
	) {}

	get position(): number {
		return this._offset;
	}

	get remaining(): number {
		return this._buffer.byteLength - this._offset;
	}

	readUint8(): number {
		return this._buffer.getUint8(this._offset++);
	}

	readUint16(): number {
		const value = this._buffer.getUint16(this._offset, this._littleEndian);
		this._offset += 2;
		return value;
	}

	readUint32(): number {
		const value = this._buffer.getUint32(this._offset, this._littleEndian);
		this._offset += 4;
		return value;
	}

	readFloat32(): number {
		const value = this._buffer.getFloat32(this._offset, this._littleEndian);
		this._offset += 4;
		return value;
	}

	readFloat64(): number {
		const value = this._buffer.getFloat64(this._offset, this._littleEndian);
		this._offset += 8;
		return value;
	}

	readBytes(length: number): Uint8Array {
		const bytes = this._buffer.getBytes(this._offset, length);
		this._offset += length;
		return bytes;
	}

	skip(length: number): void {
		this._buffer.slice(this._offset, this._offset + length);
		this._offset += length;
	}

	seek(offset: number): void {
		if (offset < 0 || offset > this._buffer.byteLength) {
			throw new RangeError(`Invalid seek position ${offset}`);
		}
		this._offset = offset;
	}
}

export class ZeroCopyWriter {
	private _offset = 0;

	constructor(
		private readonly _buffer: ZeroCopyBuffer,
		private readonly _littleEndian = false
	) {}

	get position(): number {
		return this._offset;
	}

	get remaining(): number {
		return this._buffer.byteLength - this._offset;
	}

	writeUint8(value: number): void {
		this._buffer.writeUint8(this._offset++, value);
	}

	writeUint16(value: number): void {
		this._buffer.writeUint16(this._offset, value, this._littleEndian);
		this._offset += 2;
	}

	writeUint32(value: number): void {
		this._buffer.writeUint32(this._offset, value, this._littleEndian);
		this._offset += 4;
	}

	writeFloat32(value: number): void {
		this._buffer.writeFloat32(this._offset, value, this._littleEndian);
		this._offset += 4;
	}

	writeFloat64(value: number): void {
		this._buffer.writeFloat64(this._offset, value, this._littleEndian);
		this._offset += 8;
	}

	writeBytes(bytes: Uint8Array): void {
		this._buffer.writeBytes(this._offset, bytes);
		this._offset += bytes.byteLength;
	}

	padTo(alignment: number, fill = 0): void {
		const remainder = this._offset % alignment;
		if (remainder === 0) {
			return;
		}
		const padding = alignment - remainder;
		for (let i = 0; i < padding; i++) {
			this.writeUint8(fill);
		}
	}

	seek(offset: number): void {
		if (offset < 0 || offset > this._buffer.byteLength) {
			throw new RangeError(`Invalid seek position ${offset}`);
		}
		this._offset = offset;
	}
}
