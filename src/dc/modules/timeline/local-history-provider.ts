/**
 * Dardcor Code - Local File Revision Snapshot Auto-Saver
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';

declare const require: any;

export interface ILocalHistoryEntry {
	readonly id: string;
	readonly resource: URI;
	readonly timestamp: number;
	readonly label: string;
	readonly content: string;
	readonly size: number;
}

export class LocalHistoryProvider extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _entries = new Map<string, ILocalHistoryEntry[]>();
	private readonly _rootPath: string;
	private _idCounter = 1;
	private _maxEntriesPerFile = 20;
	private _storageEnabled = false;

	constructor(rootPath = '') {
		super();
		this._rootPath = rootPath;
		this._storageEnabled = !!this._rootPath;
		void this._loadFromDisk();
	}

	public get maxEntriesPerFile(): number {
		return this._maxEntriesPerFile;
	}

	public set maxEntriesPerFile(value: number) {
		this._maxEntriesPerFile = Math.max(1, Math.min(100, value));
	}

	public async saveSnapshot(resource: URI, content: string, label?: string): Promise<ILocalHistoryEntry | undefined> {
		if (!content) {
			return undefined;
		}
		const entry: ILocalHistoryEntry = {
			id: `local-history-${this._idCounter++}-${Date.now()}`,
			resource,
			timestamp: Date.now(),
			label: label ?? `Snapshot ${Path.basename(resource.path)}`,
			content,
			size: content.length
		};
		const key = resource.toString();
		const list = this._entries.get(key) ?? [];
		list.push(entry);
		while (list.length > this._maxEntriesPerFile) {
			list.shift();
		}
		this._entries.set(key, list);
		await this._persist(entry);
		this._onDidChange.fire();
		return entry;
	}

	public entriesFor(resource: URI): ILocalHistoryEntry[] {
		return [...(this._entries.get(resource.toString()) ?? [])].sort((a, b) => b.timestamp - a.timestamp);
	}

	public allEntries(limit = 100): ILocalHistoryEntry[] {
		const all: ILocalHistoryEntry[] = [];
		for (const list of this._entries.values()) {
			all.push(...list);
		}
		return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
	}

	public getEntry(id: string): ILocalHistoryEntry | undefined {
		for (const list of this._entries.values()) {
			const found = list.find(e => e.id === id);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	public remove(entry: ILocalHistoryEntry): void {
		const key = entry.resource.toString();
		const list = this._entries.get(key);
		if (list) {
			const idx = list.findIndex(e => e.id === entry.id);
			if (idx !== -1) {
				list.splice(idx, 1);
			}
			if (list.length === 0) {
				this._entries.delete(key);
			}
			this._onDidChange.fire();
		}
	}

	public clearForResource(resource: URI): void {
		this._entries.delete(resource.toString());
		this._onDidChange.fire();
	}

	public clearAll(): void {
		this._entries.clear();
		this._onDidChange.fire();
	}

	private _historyDir(): string {
		return Path.join(this._rootPath, '.dc', 'history');
	}

	private _fileNameFor(entry: ILocalHistoryEntry): string {
		const base = Path.basename(entry.resource.path).replace(/[^A-Za-z0-9_.-]/g, '_');
		return `${base}.${entry.timestamp}.json`;
	}

	private async _persist(entry: ILocalHistoryEntry): Promise<void> {
		if (!this._storageEnabled) {
			return;
		}
		try {
			const fs = require('node:fs/promises');
			const dir = this._historyDir();
			await fs.mkdir(dir, { recursive: true });
			await fs.writeFile(Path.join(dir, this._fileNameFor(entry)), JSON.stringify(entry), 'utf8');
		} catch {
			// penyimpanan disk opsional; jika gagal, history tetap di memori
			this._storageEnabled = false;
		}
	}

	private async _loadFromDisk(): Promise<void> {
		if (!this._storageEnabled) {
			return;
		}
		try {
			const fs = require('node:fs/promises');
			const dir = this._historyDir();
			const files: string[] = await fs.readdir(dir);
			for (const file of files) {
				if (!file.endsWith('.json')) {
					continue;
				}
				try {
					const raw = await fs.readFile(Path.join(dir, file), 'utf8');
					const parsed = JSON.parse(raw) as ILocalHistoryEntry;
					if (parsed?.resource && typeof parsed.content === 'string') {
						const key = parsed.resource.toString();
						const list = this._entries.get(key) ?? [];
						list.push(parsed);
						this._entries.set(key, list);
					}
				} catch {
					// entri korup diabaikan
				}
			}
			this._onDidChange.fire();
		} catch {
			// direktori history belum ada
		}
	}
}
