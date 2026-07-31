import { Emitter, Event } from '../../core/events/emitter.js';
import { generateUuid } from '../../core/types/uuid.js';

export interface IEditOperation {
	readonly offset: number;
	readonly length: number;
	readonly text: string;
}

export interface IQueuedEdit {
	readonly id: string;
	readonly uri: string;
	readonly edits: IEditOperation[];
	readonly queuedAt: number;
}

export interface IOfflineStorageOptions {
	readonly storageKey?: string;
	readonly maxEntries?: number;
}

export const DEFAULT_STORAGE_KEY = 'dc-offline-edits';

function isLocalStorageAvailable(): boolean {
	try {
		return typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
	} catch {
		return false;
	}
}

export function serializeQueuedEdits(entries: IQueuedEdit[]): string {
	return JSON.stringify(entries);
}

export function deserializeQueuedEdits(content: string): IQueuedEdit[] {
	try {
		const parsed = JSON.parse(content) as IQueuedEdit[];
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((entry): entry is IQueuedEdit =>
			entry && typeof entry.id === 'string' && typeof entry.uri === 'string' && Array.isArray(entry.edits)
		);
	} catch {
		return [];
	}
}

export class OfflineStorage {
	private readonly _queue: IQueuedEdit[] = [];
	private readonly _storageKey: string;
	private readonly _maxEntries: number;
	private readonly _persist: boolean;

	private readonly _onDidEnqueue = new Emitter<IQueuedEdit>();
	readonly onDidEnqueue: Event<IQueuedEdit> = this._onDidEnqueue.event;

	private readonly _onDidFlush = new Emitter<IQueuedEdit[]>();
	readonly onDidFlush: Event<IQueuedEdit[]> = this._onDidFlush.event;

	constructor(options: IOfflineStorageOptions = {}) {
		this._storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
		this._maxEntries = options.maxEntries ?? 1000;
		this._persist = isLocalStorageAvailable();
		this._load();
	}

	get pendingCount(): number {
		return this._queue.length;
	}

	get size(): number {
		return this._queue.length;
	}

	hasPending(): boolean {
		return this._queue.length > 0;
	}

	enqueue(edit: Omit<IQueuedEdit, 'id' | 'queuedAt'>): IQueuedEdit {
		const entry: IQueuedEdit = {
			id: generateUuid(),
			uri: edit.uri,
			edits: [...edit.edits],
			queuedAt: Date.now()
		};
		if (this._queue.length >= this._maxEntries) {
			this._queue.shift();
		}
		this._queue.push(entry);
		this._persistNow();
		this._onDidEnqueue.fire(entry);
		return entry;
	}

	enqueueEdits(uri: string, edits: IEditOperation[]): IQueuedEdit {
		return this.enqueue({ uri, edits });
	}

	flush(): IQueuedEdit[] | null {
		if (this._queue.length === 0) {
			return null;
		}
		const flushed = [...this._queue];
		this._queue.length = 0;
		this._persistNow();
		this._onDidFlush.fire(flushed);
		return flushed;
	}

	flushUri(uri: string): IQueuedEdit[] {
		const matching = this._queue.filter(entry => entry.uri === uri);
		if (matching.length === 0) {
			return [];
		}
		for (const entry of matching) {
			const index = this._queue.indexOf(entry);
			this._queue.splice(index, 1);
		}
		this._persistNow();
		return matching;
	}

	peek(): IQueuedEdit | null {
		return this._queue[0] ?? null;
	}

	remove(id: string): boolean {
		const index = this._queue.findIndex(entry => entry.id === id);
		if (index === -1) {
			return false;
		}
		this._queue.splice(index, 1);
		this._persistNow();
		return true;
	}

	getAll(): IQueuedEdit[] {
		return [...this._queue];
	}

	getPendingCount(): number {
		return this.pendingCount;
	}

	clear(): void {
		if (this._queue.length > 0) {
			this._queue.length = 0;
			this._persistNow();
		}
	}

	getPendingUris(): string[] {
		const uris = new Set<string>();
		for (const entry of this._queue) {
			uris.add(entry.uri);
		}
		return [...uris];
	}

	countForUri(uri: string): number {
		return this._queue.filter(entry => entry.uri === uri).length;
	}

	private _persistNow(): void {
		if (!this._persist) {
			return;
		}
		try {
			localStorage.setItem(this._storageKey, serializeQueuedEdits(this._queue));
		} catch {
			(this as any)._persist = false;
		}
	}

	private _load(): void {
		if (!this._persist) {
			return;
		}
		try {
			const content = localStorage.getItem(this._storageKey);
			if (content) {
				const entries = deserializeQueuedEdits(content);
				this._queue.push(...entries.slice(0, this._maxEntries));
			}
		} catch {
			(this as any)._persist = false;
		}
	}
}
