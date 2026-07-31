/**
 * Dardcor Code - Recent File/Workspace LRU History Manager (Task 136)
 */

import { createDecorator } from '../instantiation/annotations';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { URI } from '../../core/types/uri';
import { IStorageService, StorageScope, StorageTarget } from '../storage/storage-service';

const RECENT_FILES_KEY = 'history.recentFiles';
const RECENT_WORKSPACES_KEY = 'history.recentWorkspaces';
const MAX_ENTRIES = 100;

export interface IRecentEntry {
	readonly uri: URI;
	readonly timestamp: number;
}

export interface IHistoryService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeRecentEntries: Event<void>;
	addToRecentFiles(fileUri: URI): void;
	addToRecentWorkspaces(workspaceUri: URI): void;
	removeFromRecent(uri: URI): void;
	clearRecentFiles(): void;
	clearRecentWorkspaces(): void;
	getRecentFiles(max?: number): IRecentEntry[];
	getRecentWorkspaces(max?: number): IRecentEntry[];
}

export const IHistoryService = createDecorator<IHistoryService>('historyService');

interface RecentEntryRecord {
	uri: string;
	timestamp: number;
}

export class HistoryService extends Disposable implements IHistoryService {
	declare readonly _serviceBrand: undefined;

	private _recentFiles: IRecentEntry[] = [];
	private _recentWorkspaces: IRecentEntry[] = [];

	private readonly _onDidChangeRecentEntries = this._register(new Emitter<void>());
	readonly onDidChangeRecentEntries = this._onDidChangeRecentEntries.event;

	constructor(private readonly _storageService: IStorageService) {
		super();
		this._recentFiles = this._read(RECENT_FILES_KEY);
		this._recentWorkspaces = this._read(RECENT_WORKSPACES_KEY);
	}

	public addToRecentFiles(fileUri: URI): void {
		this._recentFiles = this._prependAndDedupe(this._recentFiles, fileUri);
		this._persist(RECENT_FILES_KEY, this._recentFiles);
		this._onDidChangeRecentEntries.fire();
	}

	public addToRecentWorkspaces(workspaceUri: URI): void {
		this._recentWorkspaces = this._prependAndDedupe(this._recentWorkspaces, workspaceUri);
		this._persist(RECENT_WORKSPACES_KEY, this._recentWorkspaces);
		this._onDidChangeRecentEntries.fire();
	}

	public removeFromRecent(uri: URI): void {
		const uriString = uri.toString();
		let changed = false;
		this._recentFiles = this._recentFiles.filter((e) => {
			const keep = e.uri.toString() !== uriString;
			changed = changed || !keep;
			return keep;
		});
		this._recentWorkspaces = this._recentWorkspaces.filter((e) => {
			const keep = e.uri.toString() !== uriString;
			changed = changed || !keep;
			return keep;
		});
		if (changed) {
			this._persist(RECENT_FILES_KEY, this._recentFiles);
			this._persist(RECENT_WORKSPACES_KEY, this._recentWorkspaces);
			this._onDidChangeRecentEntries.fire();
		}
	}

	public clearRecentFiles(): void {
		if (this._recentFiles.length === 0) {
			return;
		}
		this._recentFiles = [];
		this._persist(RECENT_FILES_KEY, this._recentFiles);
		this._onDidChangeRecentEntries.fire();
	}

	public clearRecentWorkspaces(): void {
		if (this._recentWorkspaces.length === 0) {
			return;
		}
		this._recentWorkspaces = [];
		this._persist(RECENT_WORKSPACES_KEY, this._recentWorkspaces);
		this._onDidChangeRecentEntries.fire();
	}

	public getRecentFiles(max: number = MAX_ENTRIES): IRecentEntry[] {
		return this._recentFiles.slice(0, max);
	}

	public getRecentWorkspaces(max: number = MAX_ENTRIES): IRecentEntry[] {
		return this._recentWorkspaces.slice(0, max);
	}

	private _prependAndDedupe(entries: IRecentEntry[], uri: URI): IRecentEntry[] {
		const uriString = uri.toString();
		const filtered = entries.filter((e) => e.uri.toString() !== uriString);
		filtered.unshift({ uri, timestamp: Date.now() });
		return filtered.slice(0, MAX_ENTRIES);
	}

	private _read(key: string): IRecentEntry[] {
		const raw = this._storageService.get(key, StorageScope.GLOBAL, '');
		if (!raw) {
			return [];
		}
		try {
			const records = JSON.parse(raw) as RecentEntryRecord[];
			if (!Array.isArray(records)) {
				return [];
			}
			return records
				.filter((r) => r && typeof r.uri === 'string' && typeof r.timestamp === 'number')
				.map((r) => ({ uri: URI.parse(r.uri), timestamp: r.timestamp }))
				.sort((a, b) => b.timestamp - a.timestamp);
		} catch {
			return [];
		}
	}

	private _persist(key: string, entries: IRecentEntry[]): void {
		const records: RecentEntryRecord[] = entries.map((e) => ({ uri: e.uri.toString(), timestamp: e.timestamp }));
		this._storageService.store(key, JSON.stringify(records), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}
}
