/**
 * Dardcor Code - Persistent Search Query Term History Stack
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ISearchHistoryOptions {
	readonly storageKey?: string;
	readonly maxEntries?: number;
}

export class SearchHistory extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _storageKey: string;
	private readonly _maxEntries: number;
	private _entries: string[] = [];

	constructor(options: ISearchHistoryOptions = {}) {
		super();
		this._storageKey = options.storageKey ?? 'dc.search.history';
		this._maxEntries = options.maxEntries ?? 50;
		this._load();
	}

	get entries(): string[] {
		return [...this._entries];
	}

	public push(query: string): void {
		const trimmed = query.trim();
		if (!trimmed) {
			return;
		}
		const idx = this._entries.indexOf(trimmed);
		if (idx !== -1) {
			this._entries.splice(idx, 1);
		}
		this._entries.unshift(trimmed);
		if (this._entries.length > this._maxEntries) {
			this._entries = this._entries.slice(0, this._maxEntries);
		}
		this._save();
		this._onDidChange.fire();
	}

	public recent(limit = 10): string[] {
		return this._entries.slice(0, limit);
	}

	public remove(query: string): void {
		const idx = this._entries.indexOf(query);
		if (idx !== -1) {
			this._entries.splice(idx, 1);
			this._save();
			this._onDidChange.fire();
		}
	}

	public clear(): void {
		if (this._entries.length > 0) {
			this._entries = [];
			this._save();
			this._onDidChange.fire();
		}
	}

	public has(query: string): boolean {
		return this._entries.includes(query);
	}

	public exportEntries(): string[] {
		return this.recent(this._maxEntries);
	}

	private _load(): void {
		try {
			const raw = localStorage.getItem(this._storageKey);
			if (raw) {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					this._entries = parsed.filter((e): e is string => typeof e === 'string').slice(0, this._maxEntries);
				}
			}
		} catch {
			this._entries = [];
		}
	}

	private _save(): void {
		try {
			localStorage.setItem(this._storageKey, JSON.stringify(this._entries));
		} catch {
			// penyimpanan tidak tersedia (private mode / file://)
		}
	}
}
