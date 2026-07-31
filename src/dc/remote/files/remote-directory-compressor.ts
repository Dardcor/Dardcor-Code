import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, ReadStream } from 'node:fs';
import { readdir, stat, mkdir, open, readFile, writeFile, symlink } from 'node:fs/promises';
import { join, relative, basename, dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';

export interface ICompressOptions {
	readonly stripRoot?: boolean;
	readonly filter?: (relativePath: string, isDirectory: boolean) => boolean;
}

export interface ICompressResult {
	readonly bytes: number;
	readonly entries: number;
	readonly usedSystemTar: boolean;
}

export const TAR_BLOCK_SIZE = 512;

export class RemoteDirectoryCompressor {
	private _usedSystemTar = false;

	get lastUsedSystemTar(): boolean {
		return this._usedSystemTar;
	}

	async compressDirectory(dirPath: string, destTarPath: string, options: ICompressOptions = {}): Promise<ICompressResult> {
		await mkdir(dirname(destTarPath), { recursive: true });
		if (await this._trySystemTar('czf', dirPath, destTarPath, options)) {
			const bytes = (await stat(destTarPath)).size;
			return { bytes, entries: 0, usedSystemTar: true };
		}
		const entries: string[] = [];
		const { entries: walked, bytes } = await this._walkAndWrite(dirPath, destTarPath, options, entries);
		this._usedSystemTar = false;
		return { bytes, entries: walked, usedSystemTar: false };
	}

	async decompress(tarPath: string, destDir: string): Promise<{ entries: number; bytes: number }> {
		await mkdir(destDir, { recursive: true });
		if (await this._trySystemTar('xzf', tarPath, destDir)) {
			return { entries: 0, bytes: 0 };
		}
		const bytes = await readFile(tarPath);
		return extractTar(bytes, destDir);
	}

	async streamCompress(readable: ReadStream, destPath: string): Promise<number> {
		await mkdir(dirname(destPath), { recursive: true });
		const gzip = zlib.createGzip();
		const writable = createWriteStream(destPath);
		await pipeline(readable, gzip, writable);
		return (await stat(destPath)).size;
	}

	async decompressStream(srcPath: string, destPath: string): Promise<number> {
		const gunzip = zlib.createGunzip();
		const readable = createReadStream(srcPath);
		const writable = createWriteStream(destPath);
		await pipeline(readable, gunzip, writable);
		return (await stat(destPath)).size;
	}

	private async _trySystemTar(flags: string, source: string, dest: string, options?: ICompressOptions): Promise<boolean> {
		if (typeof process === 'undefined') {
			return false;
		}
		return new Promise<boolean>(resolvePromise => {
			const args = [flags, '-f', dest];
			if (flags === 'czf' && options?.stripRoot) {
				args.push('-C', dirname(source), basename(source));
			} else if (flags === 'czf') {
				args.push(source);
			} else {
				args.push('-C', dest);
			}
			const child = spawn('tar', args, { stdio: 'ignore', windowsHide: true });
			const timer = setTimeout(() => child.kill(), 15000);
			child.on('error', () => {
				clearTimeout(timer);
				resolvePromise(false);
			});
			child.on('exit', code => {
				clearTimeout(timer);
				resolvePromise(code === 0);
			});
		});
	}

	private async _walkAndWrite(dirPath: string, destTarPath: string, options: ICompressOptions, entries: string[]): Promise<{ entries: number; bytes: number }> {
		const chunks: Buffer[] = [];
		const rootPrefix = options.stripRoot ? dirname(dirPath) : null;
		const collected = await collectEntries(dirPath, rootPrefix, options.filter);
		for (const item of collected) {
			const data = item.isDirectory ? Buffer.alloc(0) : await readFile(item.fullPath);
			const header = buildTarHeader(item.relPath, data.length, item.isDirectory ? 0o755 : 0o644, item.isDirectory ? '5' : '0');
			chunks.push(header, data);
			entries.push(item.relPath);
		}
		chunks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
		const output = Buffer.concat(chunks);
		await writeFile(destTarPath, output);
		return { entries: entries.length, bytes: output.length };
	}
}

interface CollectedEntry {
	readonly relPath: string;
	readonly fullPath: string;
	readonly isDirectory: boolean;
}

async function collectEntries(dirPath: string, rootPrefix: string | null, filter?: ICompressOptions['filter']): Promise<CollectedEntry[]> {
	const result: CollectedEntry[] = [];
	const visit = async (current: string): Promise<void> => {
		const info = await stat(current);
		const rel = rootPrefix ? relative(rootPrefix, current).replace(/\\/g, '/') : basename(current);
		if (filter && !filter(rel, info.isDirectory())) {
			return;
		}
		if (info.isDirectory()) {
			result.push({ relPath: rel.endsWith('/') ? rel : `${rel}/`, fullPath: current, isDirectory: true });
			const entries = await readdir(current, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name === '.git' || entry.name === 'node_modules') {
					continue;
				}
				await visit(join(current, entry.name));
			}
		} else if (info.isFile()) {
			result.push({ relPath: rel, fullPath: current, isDirectory: false });
		}
	};
	await visit(dirPath);
	return result;
}

export function buildTarHeader(name: string, size: number, mode: number, typeflag: string): Buffer {
	const header = Buffer.alloc(TAR_BLOCK_SIZE);
	const longName = name.length > 100;
	if (longName) {
		const longHeader = Buffer.alloc(TAR_BLOCK_SIZE);
		writeTarField(longHeader, 0, 100, `././@LongLink`);
		writeTarField(longHeader, 100, 8, '0000000\0');
		writeTarField(longHeader, 108, 8, '0000000\0');
		writeTarField(longHeader, 116, 8, '0000000\0');
		writeTarField(longHeader, 124, 12, Buffer.from(name).length.toString(8).padStart(11, '0') + '\0');
		writeTarField(longHeader, 136, 12, '00000000000\0');
		writeTarField(longHeader, 148, 8, '        ');
		writeTarField(longHeader, 156, 1, 'L');
		writeTarField(longHeader, 257, 6, 'ustar\0');
		writeTarField(longHeader, 263, 2, '00');
		const checksum = computeChecksum(longHeader);
		writeTarField(longHeader, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
		const nameBytes = Buffer.from(name, 'utf8');
		const nameData = Buffer.concat([nameBytes, Buffer.alloc(roundUp(nameBytes.length) - nameBytes.length)]);
		return Buffer.concat([longHeader, nameData]);
	}
	writeTarField(header, 0, 100, name);
	writeTarField(header, 100, 8, mode.toString(8).padStart(7, '0') + '\0');
	writeTarField(header, 108, 8, '0000000\0');
	writeTarField(header, 116, 8, '0000000\0');
	writeTarField(header, 124, 12, size.toString(8).padStart(11, '0') + '\0');
	writeTarField(header, 136, 12, '00000000000\0');
	writeTarField(header, 148, 8, '        ');
	writeTarField(header, 156, 1, typeflag);
	writeTarField(header, 257, 6, 'ustar\0');
	writeTarField(header, 263, 2, '00');
	const checksum = computeChecksum(header);
	writeTarField(header, 148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
	return header;
}

function writeTarField(buffer: Buffer, offset: number, length: number, value: string | Buffer): void {
	const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
	const fill = length - bytes.length;
	if (fill < 0) {
		buffer.set(bytes.subarray(0, length), offset);
		return;
	}
	buffer.set(Buffer.alloc(fill, 0), offset);
	buffer.set(bytes, offset + fill);
}

function computeChecksum(header: Buffer): number {
	let sum = 0;
	for (const byte of header) {
		sum += byte;
	}
	for (let i = 148; i < 156; i++) {
		sum -= header[i];
		sum += 0x20;
	}
	return sum;
}

function roundUp(size: number): number {
	return Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
}

export async function extractTar(bytes: Uint8Array, destDir: string): Promise<{ entries: number; bytes: number }> {
	let offset = 0;
	let entries = 0;
	let totalBytes = 0;
	let pendingLongName: string | null = null;
	while (offset + TAR_BLOCK_SIZE <= bytes.length) {
		const header = Buffer.from(bytes.subarray(offset, offset + TAR_BLOCK_SIZE));
		offset += TAR_BLOCK_SIZE;
		if (header.every(byte => byte === 0)) {
			break;
		}
		const typeflag = String.fromCharCode(header[156] ?? 0);
		let name = readTarField(header, 0, 100);
		if (pendingLongName) {
			name = pendingLongName;
			pendingLongName = null;
		}
		const size = parseInt(readTarField(header, 124, 12), 8) || 0;
		const data = Buffer.from(bytes.subarray(offset, offset + roundUp(size)));
		offset += roundUp(size);
		if (typeflag === 'L') {
			pendingLongName = data.toString('utf8').replace(/\0+$/, '');
			continue;
		}
		const target = safeJoin(destDir, name);
		if (typeflag === '5') {
			await mkdir(target, { recursive: true });
		} else if (typeflag === '2') {
			const linkTarget = readTarField(header, 157, 100);
			await mkdir(dirname(target), { recursive: true });
			await symlink(linkTarget, target);
		} else if (data.length > 0 || typeflag === '0' || typeflag === '\0' || typeflag === '7') {
			await mkdir(dirname(target), { recursive: true });
			const handle = await open(target, 'w');
			try {
				await handle.write(data.subarray(0, size));
			} finally {
				await handle.close();
			}
			totalBytes += size;
		}
		entries++;
	}
	return { entries, bytes: totalBytes };
}

function readTarField(header: Buffer, offset: number, length: number): string {
	return header.subarray(offset, offset + length).toString('utf8').replace(/\0+$/, '').trim();
}

function safeJoin(root: string, name: string): string {
	const normalized = name.replace(/\\/g, '/');
	const parts = normalized.split('/').filter(part => part && part !== '.' && part !== '..');
	const target = join(root, ...parts);
	return target;
}

export async function extractTarFile(tarPath: string, destDir: string): Promise<{ entries: number; bytes: number }> {
	const bytes = await readFile(tarPath);
	return extractTar(bytes, destDir);
}
