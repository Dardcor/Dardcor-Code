/**
 * Dardcor Code - Memory Storage Backend (Task 158)
 * Mirrors: vs/platform/storage/common/storage.ts memory storage
 */

import { IDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IStorageBackend extends IDisposable {
	readonly onDidChange: Event<{ key: string; value: string | undefined }>;
	get(key: string): string | undefined;
	set(key: string, value: string): void;
	delete(key: string): void;
	clear(): void;
}

export class MemoryStorageBackend implements IStorageBackend {
	private readonly _store = new Map<string, string>();
	private readonly _onDidChange = new Emitter<{ key: string; value: string | undefined }>();
	readonly onDidChange: Event<{ key: string; value: string | undefined }> = this._onDidChange.event;

	get(key: string): string | undefined {
		return this._store.get(key);
	}

	set(key: string, value: string): void {
		this._store.set(key, value);
		this._onDidChange.fire({ key, value });
	}

	delete(key: string): void {
		if (this._store.delete(key)) {
			this._onDidChange.fire({ key, value: undefined });
		}
	}

	clear(): void {
		this._store.clear();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._store.clear();
	}
}
