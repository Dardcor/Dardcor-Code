/**
 * Dardcor Code - Find Search Terms History Stack
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { IStorageService, StorageScope, StorageTarget } from "../../../services/storage/storage-service.js";

export interface IFindHistoryEntry {
	readonly query: string;
	readonly timestamp: number;
}

const STORAGE_KEY = "dc.editor.findHistory";
const DEFAULT_MAX_LENGTH = 10;

/**
 * Keeps a bounded stack of search terms. Pushing a term moves it to the front
 * (most recent first) and deduplicates older identical terms; `undo`/`redo`
 * move a cursor through the history like VS Code's find input arrows.
 * Persisted through IStorageService so recent searches survive restarts.
 */
export class FindHistory extends Disposable {
	private readonly _storageService: IStorageService;
	private readonly _maxLength: number;
	private readonly _entries: IFindHistoryEntry[] = [];
	private _cursor: number = -1;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(storageService: IStorageService, maxLength: number = DEFAULT_MAX_LENGTH) {
		super();
		this._storageService = storageService;
		this._maxLength = maxLength;
		this._load();
	}

	public push(query: string): void {
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			return;
		}
		const index = this._entries.findIndex(entry => entry.query === trimmed);
		if (index !== -1) {
			this._entries.splice(index, 1);
		}
		this._entries.unshift({ query: trimmed, timestamp: Date.now() });
		while (this._entries.length > this._maxLength) {
			this._entries.pop();
		}
		this._cursor = -1;
		this._persist();
		this._onDidChange.fire();
	}

	public getEntries(): readonly IFindHistoryEntry[] {
		return this._entries.map(entry => ({ ...entry }));
	}

	public getQueries(): string[] {
		return this._entries.map(entry => entry.query);
	}

	public getMostRecent(): string | null {
		return this._entries[0]?.query ?? null;
	}

	public undo(): string | null {
		if (this._entries.length === 0) {
			return null;
		}
		if (this._cursor === -1) {
			this._cursor = 0;
		} else {
			this._cursor = Math.min(this._cursor + 1, this._entries.length - 1);
		}
		return this._entries[this._cursor].query;
	}

	public redo(): string | null {
		if (this._cursor <= 0) {
			return null;
		}
		this._cursor--;
		return this._entries[this._cursor].query;
	}

	public canUndo(): boolean {
		return this._entries.length > 0;
	}

	public canRedo(): boolean {
		return this._cursor > 0;
	}

	public resetCursor(): void {
		this._cursor = -1;
	}

	public clear(): void {
		this._entries.length = 0;
		this._cursor = -1;
		this._persist();
		this._onDidChange.fire();
	}

	public getLength(): number {
		return this._entries.length;
	}

	private _persist(): void {
		this._storageService.store(STORAGE_KEY, JSON.stringify(this._entries), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private _load(): void {
		this._entries.length = 0;
		const raw = this._storageService.get(STORAGE_KEY, StorageScope.GLOBAL);
		if (!raw) {
			return;
		}
		try {
			const parsed = JSON.parse(raw) as IFindHistoryEntry[];
			if (Array.isArray(parsed)) {
				for (const entry of parsed) {
					if (entry && typeof entry.query === "string" && entry.query.length > 0) {
						this._entries.push({ query: entry.query, timestamp: entry.timestamp ?? 0 });
					}
				}
			}
		} catch {
			this._entries.length = 0;
		}
	}
}
