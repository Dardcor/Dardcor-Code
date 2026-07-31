/**
 * Dardcor Code - Workspace Folding State Persistence
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { IStorageService, StorageScope, StorageTarget } from "../../../services/storage/storage-service.js";
import { FoldingModel } from "./folding-model.js";

export interface IFoldingStateEntry {
	readonly lines: readonly number[];
	readonly savedAt: number;
}

export interface IFoldingStateSnapshot {
	readonly uri: string;
	readonly collapsedLines: readonly number[];
}

const STORAGE_KEY = "dc.editor.foldingState";
const MAX_ENTRIES = 200;

/**
 * Serializes the collapsed folding regions of each resource into
 * IStorageService. Collapsed state survives editor restarts: `save` stores
 * the collapsed start lines per URI, `restore` applies them back onto a
 * FoldingModel.
 */
export class FoldingPersistence extends Disposable {
	private readonly _storageService: IStorageService;
	private readonly _data = new Map<string, IFoldingStateEntry>();

	constructor(storageService: IStorageService) {
		super();
		this._storageService = storageService;
		this._load();
		this._register(storageService.onDidChangeStorage(e => {
			if (e.key === STORAGE_KEY) {
				this._load();
			}
		}));
	}

	public save(model: FoldingModel): void {
		const textModel = model.getModel();
		if (!textModel) {
			return;
		}
		const uri = textModel.uri.toString();
		const lines = model.getCollapsedRegions().map(region => region.startLineNumber);
		if (lines.length === 0) {
			this._data.delete(uri);
		} else {
			this._data.set(uri, { lines, savedAt: Date.now() });
		}
		this._persist();
	}

	public saveLines(uri: string, collapsedLines: readonly number[]): void {
		if (collapsedLines.length === 0) {
			this._data.delete(uri);
		} else {
			this._data.set(uri, { lines: [...collapsedLines], savedAt: Date.now() });
		}
		this._persist();
	}

	public restore(model: FoldingModel, uri?: string): number {
		const textModel = model.getModel();
		if (!textModel) {
			return 0;
		}
		const key = uri ?? textModel.uri.toString();
		const entry = this._data.get(key);
		if (!entry) {
			return 0;
		}
		let restored = 0;
		for (const line of entry.lines) {
			const region = model.getRegionsAtLine(line).find(r => r.startLineNumber === line);
			if (region && !region.isCollapsed) {
				region.isCollapsed = true;
				restored++;
			}
		}
		return restored;
	}

	public getState(uri: string): IFoldingStateEntry | null {
		const entry = this._data.get(uri);
		return entry ? { ...entry, lines: [...entry.lines] } : null;
	}

	public getSnapshot(): IFoldingStateSnapshot[] {
		const snapshots: IFoldingStateSnapshot[] = [];
		for (const [uri, entry] of this._data) {
			snapshots.push({ uri, collapsedLines: [...entry.lines] });
		}
		return snapshots;
	}

	public clear(uri?: string): void {
		if (uri) {
			this._data.delete(uri);
		} else {
			this._data.clear();
		}
		this._persist();
	}

	public getEntryCount(): number {
		return this._data.size;
	}

	private _persist(): void {
		const payload: Record<string, IFoldingStateEntry> = {};
		for (const [uri, entry] of this._data) {
			payload[uri] = entry;
		}
		this._storageService.store(STORAGE_KEY, JSON.stringify(payload), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private _load(): void {
		this._data.clear();
		const raw = this._storageService.get(STORAGE_KEY, StorageScope.GLOBAL);
		if (!raw) {
			return;
		}
		try {
			const parsed = JSON.parse(raw) as Record<string, IFoldingStateEntry>;
			for (const [uri, entry] of Object.entries(parsed)) {
				if (entry && Array.isArray(entry.lines)) {
					this._data.set(uri, {
						lines: entry.lines.filter(l => Number.isInteger(l) && l > 0),
						savedAt: entry.savedAt ?? 0
					});
				}
			}
			this._trim();
		} catch {
			this._data.clear();
		}
	}

	private _trim(): void {
		if (this._data.size <= MAX_ENTRIES) {
			return;
		}
		const entries = Array.from(this._data.entries()).sort((a, b) => b[1].savedAt - a[1].savedAt);
		for (let i = MAX_ENTRIES; i < entries.length; i++) {
			this._data.delete(entries[i][0]);
		}
	}
}
