export const enum SerializerTag {
	Null = 0x00,
	False = 0x01,
	True = 0x02,
	Int = 0x03,
	Float = 0x04,
	String = 0x05,
	Array = 0x06,
	Map = 0x07
}

export class BinarySerializerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BinarySerializerError';
	}
}

export function encodeZigZag(value: number): number {
	return (value << 1) ^ (value >> 31);
}

export function decodeZigZag(value: number): number {
	return (value >>> 1) ^ -(value & 1);
}

export class BinarySerializer {
	encode(value: unknown): Uint8Array {
		const writer = new ByteWriter();
		this._writeValue(writer, value);
		return writer.toBytes();
	}

	decode(bytes: Uint8Array): unknown {
		const reader = new ByteReader(bytes);
		const value = this._readValue(reader);
		if (!reader.isAtEnd()) {
			throw new BinarySerializerError(`Trailing bytes after decoded value at offset ${reader.offset}`);
		}
		return value;
	}

	decodeFrom(buffer: ArrayBuffer): unknown {
		return this.decode(new Uint8Array(buffer));
	}

	encodeToBuffer(value: unknown): ArrayBuffer {
		return this.encode(value).buffer;
	}

	private _writeValue(writer: ByteWriter, value: unknown): void {
		if (value === null || value === undefined) {
			writer.writeByte(SerializerTag.Null);
			return;
		}
		if (value === false) {
			writer.writeByte(SerializerTag.False);
			return;
		}
		if (value === true) {
			writer.writeByte(SerializerTag.True);
			return;
		}
		if (typeof value === 'number') {
			if (Number.isInteger(value) && Math.abs(value) <= 0x7fffffff) {
				writer.writeByte(SerializerTag.Int);
				writer.writeVarint(encodeZigZag(value));
			} else {
				writer.writeByte(SerializerTag.Float);
				writer.writeFloat64(value);
			}
			return;
		}
		if (typeof value === 'bigint') {
			writer.writeByte(SerializerTag.Int);
			const numberValue = Number(value);
			if (numberValue > 0x7fffffff || numberValue < -0x80000000) {
				writer.writeByte(SerializerTag.Float);
				writer.writeFloat64(numberValue);
				return;
			}
			writer.writeVarint(encodeZigZag(numberValue));
			return;
		}
		if (typeof value === 'string') {
			writer.writeByte(SerializerTag.String);
			const bytes = new TextEncoder().encode(value);
			writer.writeVarint(bytes.length);
			writer.writeBytes(bytes);
			return;
		}
		if (Array.isArray(value)) {
			writer.writeByte(SerializerTag.Array);
			writer.writeVarint(value.length);
			for (const item of value) {
				this._writeValue(writer, item);
			}
			return;
		}
		if (value instanceof Uint8Array) {
			writer.writeByte(SerializerTag.Array);
			writer.writeVarint(value.length);
			for (let i = 0; i < value.length; i++) {
				writer.writeByte(SerializerTag.Int);
				writer.writeVarint(encodeZigZag(value[i]));
			}
			return;
		}
		if (typeof value === 'object') {
			writer.writeByte(SerializerTag.Map);
			const entries = Object.entries(value as Record<string, unknown>);
			writer.writeVarint(entries.length);
			for (const [key, entry] of entries) {
				this._writeValue(writer, key);
				this._writeValue(writer, entry);
			}
			return;
		}
		throw new BinarySerializerError(`Unsupported value type: ${typeof value}`);
	}

	private _readValue(reader: ByteReader): unknown {
		const tag = reader.readByte();
		switch (tag) {
			case SerializerTag.Null:
				return null;
			case SerializerTag.False:
				return false;
			case SerializerTag.True:
				return true;
			case SerializerTag.Int:
				return decodeZigZag(reader.readVarint());
			case SerializerTag.Float:
				return reader.readFloat64();
			case SerializerTag.String: {
				const length = reader.readVarint();
				return new TextDecoder().decode(reader.readBytes(length));
			}
			case SerializerTag.Array: {
				const length = reader.readVarint();
				const result: unknown[] = new Array(length);
				for (let i = 0; i < length; i++) {
					result[i] = this._readValue(reader);
				}
				return result;
			}
			case SerializerTag.Map: {
				const length = reader.readVarint();
				const result: Record<string, unknown> = {};
				for (let i = 0; i < length; i++) {
					const key = this._readValue(reader);
					const value = this._readValue(reader);
					result[String(key)] = value;
				}
				return result;
			}
			default:
				throw new BinarySerializerError(`Unknown tag byte 0x${tag.toString(16)} at offset ${reader.offset - 1}`);
		}
	}
}

class ByteWriter {
	private readonly _chunks: Uint8Array[] = [];
	private _length = 0;

	writeByte(value: number): void {
		this._chunks.push(new Uint8Array([value & 0xff]));
		this._length++;
	}

	writeVarint(value: number): void {
		let v = value >>> 0;
		const bytes: number[] = [];
		do {
			let byte = v & 0x7f;
			v >>>= 7;
			if (v > 0) {
				byte |= 0x80;
			}
			bytes.push(byte);
		} while (v > 0);
		this._chunks.push(new Uint8Array(bytes));
		this._length += bytes.length;
	}

	writeFloat64(value: number): void {
		const bytes = new Uint8Array(8);
		const view = new DataView(bytes.buffer);
		view.setFloat64(0, value, true);
		this._chunks.push(bytes);
		this._length += 8;
	}

	writeBytes(bytes: Uint8Array): void {
		this._chunks.push(bytes);
		this._length += bytes.length;
	}

	toBytes(): Uint8Array {
		const result = new Uint8Array(this._length);
		let offset = 0;
		for (const chunk of this._chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	}
}

class ByteReader {
	private readonly _bytes: Uint8Array;
	private readonly _view: DataView;
	private _offset = 0;

	constructor(bytes: Uint8Array) {
		this._bytes = bytes;
		this._view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get offset(): number {
		return this._offset;
	}

	get remaining(): number {
		return this._bytes.length - this._offset;
	}

	isAtEnd(): boolean {
		return this._offset >= this._bytes.length;
	}

	readByte(): number {
		this._ensure(1);
		return this._bytes[this._offset++];
	}

	readVarint(): number {
		let result = 0;
		let shift = 0;
		for (;;) {
			this._ensure(1);
			const byte = this._bytes[this._offset++];
			result |= (byte & 0x7f) << shift;
			if ((byte & 0x80) === 0) {
				return result >>> 0;
			}
			shift += 7;
			if (shift > 35) {
				throw new BinarySerializerError('Varint is too long');
			}
		}
	}

	readFloat64(): number {
		this._ensure(8);
		const value = this._view.getFloat64(this._offset, true);
		this._offset += 8;
		return value;
	}

	readBytes(length: number): Uint8Array {
		this._ensure(length);
		const bytes = this._bytes.subarray(this._offset, this._offset + length);
		this._offset += length;
		return bytes;
	}

	private _ensure(length: number): void {
		if (this._offset + length > this._bytes.length) {
			throw new BinarySerializerError(`Unexpected end of buffer: need ${length} bytes at offset ${this._offset}, have ${this.remaining}`);
		}
	}
}

export function serialize(value: unknown): Uint8Array {
	return new BinarySerializer().encode(value);
}

export function deserialize(bytes: Uint8Array): unknown {
	return new BinarySerializer().decode(bytes);
}
