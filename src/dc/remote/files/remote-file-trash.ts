import { readdir, stat, mkdir, rename, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ITrashEntry {
	readonly id: string;
	readonly originalPath: string;
	readonly trashPath: string;
	readonly infoPath: string;
	readonly deletedAt: string;
}

export interface ITrashOptions {
	readonly trashDir?: string;
	readonly fallbackDir?: string;
}

export function formatTrashDate(date: Date): string {
	return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function getXdgTrashDir(): string {
	const xdgDataHome = typeof process !== 'undefined' ? process.env.XDG_DATA_HOME : undefined;
	const base = xdgDataHome || join(homedir(), '.local', 'share');
	return join(base, 'Trash');
}

export function parseTrashInfo(content: string): { originalPath: string; deletedAt: string } | null {
	const lines = content.split(/\r?\n/);
	let originalPath = '';
	let deletedAt = '';
	for (const line of lines) {
		if (line.startsWith('Path=')) {
			originalPath = line.slice(5).trim();
		} else if (line.startsWith('Deleted=')) {
			deletedAt = line.slice(8).trim();
		}
	}
	if (!originalPath) {
		return null;
	}
	return { originalPath, deletedAt };
}

export function encodeTrashPath(path: string): string {
	return path.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

export function decodeTrashPath(path: string): string {
	return path.replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

export class RemoteFileTrash {
	private readonly _trashDir: string;
	private readonly _fallbackDir: string;

	private readonly _onDidTrash = new Emitter<ITrashEntry>();
	readonly onDidTrash: Event<ITrashEntry> = this._onDidTrash.event;

	constructor(options: ITrashOptions = {}) {
		this._trashDir = options.trashDir ?? getXdgTrashDir();
		this._fallbackDir = options.fallbackDir ?? join(this._trashDir, '.dc-fallback');
	}

	get trashDir(): string {
		return this._trashDir;
	}

	async trash(path: string): Promise<boolean> {
		const info = await stat(path).catch(() => null);
		if (!info) {
			return false;
		}
		const id = `${Date.now()}-${basename(path)}`;
		const filesDir = join(this._trashDir, 'files');
		const infoDir = join(this._trashDir, 'info');
		try {
			await mkdir(filesDir, { recursive: true });
			await mkdir(infoDir, { recursive: true });
			const trashPath = join(filesDir, id);
			const infoPath = join(infoDir, `${id}.trashinfo`);
			await rename(path, trashPath);
			const deletedAt = formatTrashDate(new Date());
			const trashInfo = `[Trash Info]\nPath=${encodeTrashPath(resolve(path))}\nDeleted=${deletedAt}\n`;
			await writeFile(infoPath, trashInfo, 'utf8');
			const entry: ITrashEntry = { id, originalPath: resolve(path), trashPath, infoPath, deletedAt };
			this._onDidTrash.fire(entry);
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
				return this._fallbackTrash(path, info.isDirectory());
			}
			throw error;
		}
	}

	async restore(entry: ITrashEntry | string): Promise<boolean> {
		const resolved = typeof entry === 'string' ? await this.getEntry(entry) : entry;
		if (!resolved) {
			return false;
		}
		await mkdir(dirname(resolved.originalPath), { recursive: true });
		await rename(resolved.trashPath, resolved.originalPath);
		await unlink(resolved.infoPath).catch(() => undefined);
		return true;
	}

	async listTrash(): Promise<ITrashEntry[]> {
		const infoDir = join(this._trashDir, 'info');
		try {
			const files = await readdir(infoDir);
			const entries: ITrashEntry[] = [];
			for (const file of files) {
				if (!file.endsWith('.trashinfo')) {
					continue;
				}
				const infoPath = join(infoDir, file);
				const content = await readFile(infoPath, 'utf8').catch(() => '');
				const parsed = parseTrashInfo(content);
				const id = file.slice(0, -'.trashinfo'.length);
				const trashPath = join(this._trashDir, 'files', id);
				if (parsed) {
					entries.push({
						id,
						originalPath: decodeTrashPath(parsed.originalPath),
						trashPath,
						infoPath,
						deletedAt: parsed.deletedAt
					});
				}
			}
			return entries.sort((a, b) => a.deletedAt.localeCompare(b.deletedAt));
		} catch {
			return [];
		}
	}

	async getEntry(id: string): Promise<ITrashEntry | null> {
		const entries = await this.listTrash();
		return entries.find(entry => entry.id === id) ?? null;
	}

	async empty(): Promise<number> {
		const entries = await this.listTrash();
		for (const entry of entries) {
			await rm(entry.trashPath, { recursive: true, force: true }).catch(() => undefined);
			await unlink(entry.infoPath).catch(() => undefined);
		}
		return entries.length;
	}

	async isEmpty(): Promise<boolean> {
		return (await this.listTrash()).length === 0;
	}

	async restoreAll(): Promise<number> {
		const entries = await this.listTrash();
		let restored = 0;
		for (const entry of entries) {
			if (await this.restore(entry)) {
				restored++;
			}
		}
		return restored;
	}

	async getTrashSize(): Promise<number> {
		const entries = await this.listTrash();
		let total = 0;
		for (const entry of entries) {
			const info = await stat(entry.trashPath).catch(() => null);
			if (info?.isFile()) {
				total += info.size;
			}
		}
		return total;
	}

	private async _fallbackTrash(path: string, isDirectory: boolean): Promise<boolean> {
		await mkdir(this._fallbackDir, { recursive: true });
		const id = `${Date.now()}-${basename(path)}`;
		await rename(path, join(this._fallbackDir, id));
		const entry: ITrashEntry = {
			id,
			originalPath: resolve(path),
			trashPath: join(this._fallbackDir, id),
			infoPath: join(this._fallbackDir, `${id}.trashinfo`),
			deletedAt: formatTrashDate(new Date())
		};
		this._onDidTrash.fire(entry);
		void isDirectory;
		return true;
	}
}

export function trashDirExists(): boolean {
	return existsSync(join(getXdgTrashDir(), 'files'));
}
