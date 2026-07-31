/**
 * Dardcor Code - Zip Package Reader (Task 95)
 */

export interface IZipEntry {
	name: string;
	compressedSize: number;
	uncompressedSize: number;
	isDirectory: boolean;
	data: Uint8Array;
}

export async function readZip(buffer: ArrayBuffer): Promise<IZipEntry[]> {
	// Use native DecompressionStream for deflate entries
	const view = new DataView(buffer);
	const entries: IZipEntry[] = [];
	let offset = 0;
	const bytes = new Uint8Array(buffer);

	while (offset < bytes.length - 4) {
		const sig = view.getUint32(offset, true);
		if (sig !== 0x04034b50) break; // PK\x03\x04

		const compressionMethod = view.getUint16(offset + 8, true);
		const compressedSize = view.getUint32(offset + 18, true);
		const uncompressedSize = view.getUint32(offset + 22, true);
		const nameLen = view.getUint16(offset + 26, true);
		const extraLen = view.getUint16(offset + 28, true);
		const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
		const dataStart = offset + 30 + nameLen + extraLen;
		const rawData = bytes.subarray(dataStart, dataStart + compressedSize);

		let data: Uint8Array;
		if (compressionMethod === 8 && compressedSize > 0) {
			// Deflate - use native decompression
			try {
				const ds = new DecompressionStream('deflate-raw');
				const writer = ds.writable.getWriter();
				writer.write(rawData);
				writer.close();
				const reader = ds.readable.getReader();
				const chunks: Uint8Array[] = [];
				let totalLen = 0;
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					chunks.push(value);
					totalLen += value.length;
				}
				data = new Uint8Array(totalLen);
				let off = 0;
				for (const chunk of chunks) { data.set(chunk, off); off += chunk.length; }
			} catch {
				data = rawData; // Fallback
			}
		} else {
			data = new Uint8Array(rawData);
		}

		entries.push({
			name,
			compressedSize,
			uncompressedSize,
			isDirectory: name.endsWith('/'),
			data,
		});

		offset = dataStart + compressedSize;
	}
	return entries;
}

export function findZipEntry(entries: IZipEntry[], name: string): IZipEntry | undefined {
	return entries.find(e => e.name === name);
}
