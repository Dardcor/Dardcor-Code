/**
 * Dardcor Code - Historical Autocomplete Selection Memory
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { IStorageService, StorageScope, StorageTarget } from "../../../services/storage/storage-service.js";
import { CompletionItem } from "./completion-item.js";

export interface ISuggestMemoryEntry {
	readonly label: string;
	readonly count: number;
	readonly lastUsed: number;
}

export interface ISuggestMemoryState {
	readonly entries: readonly ISuggestMemoryEntry[];
	readonly isEnabled: boolean;
}

const STORAGE_KEY = "dc.editor.suggestMemory";
const DEFAULT_MAX_ENTRIES = 100;

/**
 * Remembers which completion items the user actually accepted. Accepted items
 * get a "favorite" boost in future suggestion lists (see suggest-sorting),
 * mimicking VS Code's `editor.suggest.selectionMode` memory. State persists
 * through IStorageService.
 */
export class SuggestMemory extends Disposable {
	private readonly _storageService: IStorageService;
	private readonly _maxEntries: number;
	private readonly _entries = new Map<string, ISuggestMemoryEntry>();
	private _isEnabled: boolean = true;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(storageService: IStorageService, maxEntries: number = DEFAULT_MAX_ENTRIES) {
		super();
		this._storageService = storageService;
		this._maxEntries = maxEntries;
		this._load();
		this._register(storageService.onDidChangeStorage(e => {
			if (e.key === STORAGE_KEY) {
				this._load();
			}
		}));
	}

	public setEnabled(enabled: boolean): void {
		if (this._isEnabled === enabled) {
			return;
		}
		this._isEnabled = enabled;
		this._onDidChange.fire();
	}

	public isEnabled(): boolean {
		return this._isEnabled;
	}

	public remember(item: CompletionItem): void {
		if (!this._isEnabled) {
			return;
		}
		const key = this._makeKey(item);
		const existing = this._entries.get(key);
		this._entries.set(key, {
			label: item.label,
			count: (existing?.count ?? 0) + 1,
			lastUsed: Date.now()
		});
		this._trim();
		this._persist();
		this._onDidChange.fire();
	}

	public forget(item: CompletionItem): void {
		const key = this._makeKey(item);
		if (this._entries.delete(key)) {
			this._persist();
			this._onDidChange.fire();
		}
	}

	public clear(): void {
		this._entries.clear();
		this._persist();
		this._onDidChange.fire();
	}

	public getBoost(item: CompletionItem): number {
		if (!this._isEnabled) {
			return 0;
		}
		const entry = this._entries.get(this._makeKey(item));
		if (!entry) {
			return 0;
		}
		return Math.min(50, 10 + entry.count * 4);
	}

	public applyMemory(items: CompletionItem[]): void {
		for (const item of items) {
			const boost = this.getBoost(item);
			if (boost > 0) {
				item.isFavorite = true;
				item.score += boost;
			}
		}
	}

	public getEntryCount(): number {
		return this._entries.size;
	}

	public getMostUsed(): ISuggestMemoryEntry | null {
		let best: ISuggestMemoryEntry | null = null;
		for (const entry of this._entries.values()) {
			if (!best || entry.count > best.count || (entry.count === best.count && entry.lastUsed > best.lastUsed)) {
				best = entry;
			}
		}
		return best ? { ...best } : null;
	}

	public getState(): ISuggestMemoryState {
		return {
			entries: Array.from(this._entries.values())
				.map(entry => ({ ...entry }))
				.sort((a, b) => b.count - a.count),
			isEnabled: this._isEnabled
		};
	}

	private _makeKey(item: CompletionItem): string {
		return `${item.filterText}@${item.detail}`;
	}

	private _trim(): void {
		if (this._entries.size <= this._maxEntries) {
			return;
		}
		const entries = Array.from(this._entries.entries()).sort((a, b) => b[1].lastUsed - a[1].lastUsed);
		for (let i = this._maxEntries; i < entries.length; i++) {
			this._entries.delete(entries[i][0]);
		}
	}

	private _persist(): void {
		this._storageService.store(STORAGE_KEY, JSON.stringify(Array.from(this._entries.values())), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private _load(): void {
		this._entries.clear();
		const raw = this._storageService.get(STORAGE_KEY, StorageScope.GLOBAL);
		if (!raw) {
			return;
		}
		try {
			const parsed = JSON.parse(raw) as ISuggestMemoryEntry[];
			if (Array.isArray(parsed)) {
				for (const entry of parsed) {
					if (entry && typeof entry.label === "string" && typeof entry.count === "number") {
						this._entries.set(`${entry.label}@${entry.label}`, {
							label: entry.label,
							count: entry.count,
							lastUsed: entry.lastUsed ?? 0
						});
					}
				}
			}
		} catch {
			this._entries.clear();
		}
	}
}
