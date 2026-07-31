/**
 * Dardcor Code - Remote Server VSIX Extension Installer Module (Task 815)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, renameSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { IRemoteExtensionInfo } from './remote-extension-scanner.js';

interface ZipEntry {
	readonly name: string;
	readonly method: number;
	readonly compressedSize: number;
	readonly uncompressedSize: number;
	readonly localHeaderOffset: number;
	readonly isDirectory: boolean;
}

export class RemoteExtensionInstaller extends Disposable {
	private readonly _onDidInstall = this._register(new Emitter<IRemoteExtensionInfo>());
	readonly onDidInstall: Event<IRemoteExtensionInfo> = this._onDidInstall.event;

	private readonly _onDidUninstall = this._register(new Emitter<string>());
	readonly onDidUninstall: Event<string> = this._onDidUninstall.event;

	constructor(private readonly _extensionsRoot: string) {
		super();
	}

	async installVsix(vsixPath: string): Promise<IRemoteExtensionInfo> {
		if (!existsSync(vsixPath)) {
			throw new Error(`VSIX file not found: ${vsixPath}`);
		}
		const bytes = readFileSync(vsixPath);
		const entries = parseZipEntries(bytes);
		if (entries.length === 0) {
			throw new Error('VSIX file contains no entries');
		}

		const staging = join(this._extensionsRoot, `.staging-${Date.now()}`);
		mkdirSync(staging, { recursive: true });
		try {
			for (const entry of entries) {
				const target = join(staging, entry.name);
				if (entry.isDirectory) {
					mkdirSync(target, { recursive: true });
					continue;
				}
				mkdirSync(dirname(target), { recursive: true });
				const data = extractEntry(bytes, entry);
				writeFileSync(target, data);
			}
			const pkgPath = join(staging, 'extension', 'package.json');
			if (!existsSync(pkgPath)) {
				throw new Error('VSIX does not contain extension/package.json');
			}
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string; publisher?: string; version?: string };
			if (!pkg.name || !pkg.publisher || !pkg.version) {
				throw new Error('VSIX package.json is missing name, publisher or version');
			}
			const extensionId = `${pkg.publisher}.${pkg.name}`;
			const targetDir = join(this._extensionsRoot, `${extensionId}-${pkg.version}`);
			rmSync(targetDir, { recursive: true, force: true });
			rmSync(join(this._extensionsRoot, `${extensionId}-*`), { recursive: true, force: true });
			await this._renameDir(staging, targetDir);
			const info: IRemoteExtensionInfo = {
				id: extensionId,
				name: pkg.name,
				publisher: pkg.publisher,
				version: pkg.version,
				path: targetDir,
				isBuiltin: false,
				isActive: true
			};
			this._onDidInstall.fire(info);
			return info;
		} catch (error) {
			rmSync(staging, { recursive: true, force: true });
			throw error;
		}
	}

	async uninstall(extensionId: string): Promise<void> {
		let removed = false;
		for (const entry of readdirSync(this._extensionsRoot)) {
			if (entry.startsWith(`${extensionId}-`) || entry === extensionId) {
				rmSync(join(this._extensionsRoot, entry), { recursive: true, force: true });
				removed = true;
			}
		}
		if (!removed) {
			throw new Error(`Extension '${extensionId}' is not installed`);
		}
		this._onDidUninstall.fire(extensionId);
	}

	listInstalled(): string[] {
		try {
			return readdirSync(this._extensionsRoot).filter(entry => !entry.startsWith('.'));
		} catch {
			return [];
		}
	}

	private async _renameDir(source: string, target: string): Promise<void> {
		if (existsSync(target)) {
			rmSync(target, { recursive: true, force: true });
		}
		try {
			renameSync(source, target);
		} catch {
			// Cross-device move fallback: copy + remove.
			await copyDir(source, target);
			rmSync(source, { recursive: true, force: true });
		}
	}
}

async function copyDir(source: string, target: string): Promise<void> {
	if (typeof cpSync === 'function') {
		cpSync(source, target, { recursive: true });
		return;
	}
	mkdirSync(target, { recursive: true });
	for (const entry of readdirSync(source)) {
		const sourcePath = join(source, entry);
		const targetPath = join(target, entry);
		if (statSync(sourcePath).isDirectory()) {
			await copyDir(sourcePath, targetPath);
		} else {
			writeFileSync(targetPath, readFileSync(sourcePath));
		}
	}
}

export function parseZipEntries(bytes: Uint8Array): ZipEntry[] {
	const buffer = Buffer.from(bytes);
	const eocd = findEndOfCentralDirectory(buffer);
	if (!eocd) {
		throw new Error('Not a valid ZIP archive (no end of central directory)');
	}
	const entryCount = buffer.readUInt16LE(eocd + 10);
	const cdOffset = buffer.readUInt32LE(eocd + 16);
	const entries: ZipEntry[] = [];
	let offset = cdOffset;
	for (let i = 0; i < entryCount; i++) {
		if (buffer.readUInt32LE(offset) !== 0x02014b50) {
			break;
		}
		const method = buffer.readUInt16LE(offset + 10);
		const compressedSize = buffer.readUInt32LE(offset + 20);
		const uncompressedSize = buffer.readUInt32LE(offset + 24);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const extraLength = buffer.readUInt16LE(offset + 30);
		const commentLength = buffer.readUInt16LE(offset + 32);
		const localHeaderOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
		entries.push({
			name,
			method,
			compressedSize,
			uncompressedSize,
			localHeaderOffset,
			isDirectory: name.endsWith('/')
		});
		offset += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

export function extractEntry(bytes: Uint8Array, entry: ZipEntry): Buffer {
	const buffer = Buffer.from(bytes);
	const localOffset = entry.localHeaderOffset;
	if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
		throw new Error(`Invalid local header for '${entry.name}'`);
	}
	const nameLength = buffer.readUInt16LE(localOffset + 26);
	const extraLength = buffer.readUInt16LE(localOffset + 28);
	const dataStart = localOffset + 30 + nameLength + extraLength;
	const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
	if (entry.method === 0) {
		return Buffer.from(data);
	}
	if (entry.method === 8) {
		return inflateRawSync(data);
	}
	throw new Error(`Unsupported ZIP compression method ${entry.method} for '${entry.name}'`);
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
	const minOffset = Math.max(0, buffer.length - 65557);
	for (let i = buffer.length - 22; i >= minOffset; i--) {
		if (buffer.readUInt32LE(i) === 0x06054b50) {
			return i;
		}
	}
	return undefined;
}
