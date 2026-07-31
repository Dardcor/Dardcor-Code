import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IExtensionHostV8CacheService {
	readonly onDidUpdateCache: Event<string>;
	getCache(extensionId: string): Promise<ArrayBuffer | null>;
	setCache(extensionId: string, data: ArrayBuffer): Promise<void>;
}

export class ExtensionHostV8CacheService implements IExtensionHostV8CacheService {
	private readonly _caches = new Map<string, ArrayBuffer>();
	private readonly _onDidUpdateCache = new Emitter<string>();
	readonly onDidUpdateCache = this._onDidUpdateCache.event;

	async getCache(extensionId: string): Promise<ArrayBuffer | null> {
		return this._caches.get(extensionId) || null;
	}

	async setCache(extensionId: string, data: ArrayBuffer): Promise<void> {
		this._caches.set(extensionId, data);
		this._onDidUpdateCache.fire(extensionId);
	}
}
