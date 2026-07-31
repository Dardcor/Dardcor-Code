import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostStorageService {
	readonly onDidChangeStorage: Event<{ key: string; value: string | undefined }>;
	get(key: string, defaultValue?: string): string | undefined;
	set(key: string, value: string): void;
	remove(key: string): void;
}

export class ExtensionHostStorageService implements IExtensionHostStorageService {
	private readonly _storage = new Map<string, string>();
	
	private readonly _onDidChangeStorage = new Emitter<{ key: string; value: string | undefined }>();
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	get(key: string, defaultValue?: string): string | undefined {
		return this._storage.has(key) ? this._storage.get(key) : defaultValue;
	}

	set(key: string, value: string): void {
		this._storage.set(key, value);
		this._onDidChangeStorage.fire({ key, value });
	}

	remove(key: string): void {
		if (this._storage.has(key)) {
			this._storage.delete(key);
			this._onDidChangeStorage.fire({ key, value: undefined });
		}
	}
}
