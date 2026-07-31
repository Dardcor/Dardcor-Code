/**
 * Dardcor Code - Tar Archive Reader (Task 83)
 * Mirrors: extension packaging tar reader
 */

export interface ITarEntry {
	name: string;
	size: number;
	type: 'file' | 'directory';
	data: Uint8Array;
}

export function parseTar(buffer: ArrayBuffer): ITarEntry[] {
	const entries: ITarEntry[] = [];
	const view = new Uint8Array(buffer);
	let offset = 0;

	while (offset < view.length - 512) {
		// Check for end-of-archive (two zero blocks)
		let allZero = true;
		for (let i = 0; i < 512; i++) {
			if (view[offset + i] !== 0) { allZero = false; break; }
		}
		if (allZero) break;

		const name = readString(view, offset, 100).replace(/\0+$/, '');
		if (!name) break;

		const sizeStr = readString(view, offset + 124, 12).replace(/\0+$/, '').trim();
		const size = parseInt(sizeStr, 8) || 0;
		const typeFlag = String.fromCharCode(view[offset + 156]);
		const isDir = typeFlag === '5' || name.endsWith('/');

		offset += 512; // Skip header block

		const data = new Uint8Array(buffer, offset, size);
		entries.push({
			name,
			size,
			type: isDir ? 'directory' : 'file',
			data: new Uint8Array(data),
		});

		// Advance past data blocks (512-byte aligned)
		offset += Math.ceil(size / 512) * 512;
	}

	return entries;
}

function readString(view: Uint8Array, offset: number, length: number): string {
	let result = '';
	for (let i = 0; i < length; i++) {
		const code = view[offset + i];
		if (code === 0) break;
		result += String.fromCharCode(code);
	}
	return result;
}

export function findEntry(entries: ITarEntry[], name: string): ITarEntry | undefined {
	return entries.find(e => e.name === name || e.name === './' + name);
}

export function extractTextFile(entries: ITarEntry[], name: string): string | undefined {
	const entry = findEntry(entries, name);
	if (!entry || entry.type !== 'file') return undefined;
	return new TextDecoder().decode(entry.data);
}
