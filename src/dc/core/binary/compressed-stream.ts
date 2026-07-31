/**
 * Dardcor Code - Compressed Stream Decoder (Task 66)
 * Mirrors: vs/base/common/buffer.ts compressed stream utilities
 */

export class CompressedStreamDecoder {
	/**
	 * Decompress a gzip/deflate ArrayBuffer using native DecompressionStream API.
	 */
	static async decompress(data: ArrayBuffer, format: 'gzip' | 'deflate' = 'gzip'): Promise<ArrayBuffer> {
		const ds = new DecompressionStream(format);
		const writer = ds.writable.getWriter();
		writer.write(new Uint8Array(data));
		writer.close();
		const reader = ds.readable.getReader();
		const chunks: Uint8Array[] = [];
		let totalLength = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			totalLength += value.length;
		}
		const result = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result.buffer;
	}

	/**
	 * Compress data using native CompressionStream API.
	 */
	static async compress(data: ArrayBuffer, format: 'gzip' | 'deflate' = 'gzip'): Promise<ArrayBuffer> {
		const cs = new CompressionStream(format);
		const writer = cs.writable.getWriter();
		writer.write(new Uint8Array(data));
		writer.close();
		const reader = cs.readable.getReader();
		const chunks: Uint8Array[] = [];
		let totalLength = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			totalLength += value.length;
		}
		const result = new Uint8Array(totalLength);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.length;
		}
		return result.buffer;
	}
}
