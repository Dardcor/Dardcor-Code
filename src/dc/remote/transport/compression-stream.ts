export type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw';

export interface ICompressionResult {
	readonly data: Uint8Array;
	readonly compressed: boolean;
	readonly format: CompressionFormat | 'none';
}

const GZIP_HEADER = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03]);

export function isCompressionStreamSupported(): boolean {
	return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export function isGzipData(bytes: Uint8Array): boolean {
	return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function hasGzipHeader(bytes: Uint8Array): boolean {
	return isGzipData(bytes);
}

export class CompressionStream {
	static isSupported(): boolean {
		return isCompressionStreamSupported();
	}

	async compress(bytes: Uint8Array): Promise<ICompressionResult> {
		if (!isCompressionStreamSupported()) {
			return { data: bytes, compressed: false, format: 'none' };
		}
		try {
			const stream = new CompressionStream('gzip');
			const compressed = await this._transform(bytes, stream);
			return { data: compressed, compressed: true, format: 'gzip' };
		} catch {
			return { data: bytes, compressed: false, format: 'none' };
		}
	}

	async decompress(bytes: Uint8Array): Promise<ICompressionResult> {
		if (!isCompressionStreamSupported() || !isGzipData(bytes)) {
			return { data: bytes, compressed: false, format: 'none' };
		}
		try {
			const stream = new DecompressionStream('gzip');
			const decompressed = await this._transform(bytes, stream);
			return { data: decompressed, compressed: false, format: 'gzip' };
		} catch {
			return { data: bytes, compressed: false, format: 'none' };
		}
	}

	async compressBytes(bytes: Uint8Array): Promise<Uint8Array> {
		const result = await this.compress(bytes);
		return result.data;
	}

	async decompressBytes(bytes: Uint8Array): Promise<Uint8Array> {
		const result = await this.decompress(bytes);
		return result.data;
	}

	async compressToBase64(bytes: Uint8Array): Promise<string> {
		const result = await this.compress(bytes);
		return bytesToBase64(result.data);
	}

	async decompressFromBase64(value: string): Promise<Uint8Array> {
		const bytes = base64ToBytes(value);
		const result = await this.decompress(bytes);
		return result.data;
	}

	isCompressed(bytes: Uint8Array): boolean {
		return isGzipData(bytes);
	}

	getFormat(bytes: Uint8Array): CompressionFormat | 'none' {
		return isGzipData(bytes) ? 'gzip' : 'none';
	}

	estimateCompressionRatio(bytes: Uint8Array): number {
		const sample = bytes.subarray(0, Math.min(4096, bytes.length));
		const unique = new Set<number>(sample);
		return sample.length > 0 ? unique.size / sample.length : 0;
	}

	private async _transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
		const writer = stream.writable.getWriter();
		writer.write(bytes);
		writer.close();
		const reader = stream.readable.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			chunks.push(value);
			total += value.length;
		}
		const result = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result;
	}
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
	}
	return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export const GZIP_MAGIC_BYTES = GZIP_HEADER;
