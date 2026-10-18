/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { SequencerByKey } from '../../../base/common/async.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentPluginManager, type ISyncedCustomization } from '../common/agentPluginManager.js';
import { CustomizationLoadStatus, type ClientPluginCustomization, type PluginCustomization } from '../common/state/sessionState.js';
import { toAgentClientUri } from '../common/agentClientUri.js';

const DEFAULT_MAX_PLUGIN_REVISIONS = 64;

const MAX_REVISIONS_PER_PLUGIN = 8;

interface ICacheEntry {
	readonly uri: string;
	readonly nonce: string;
}

export class AgentPluginManager implements IAgentPluginManager {
	declare readonly _serviceBrand: undefined;

	private readonly _basePath: URI;
	private readonly _cachePath: URI;
	private readonly _maxRevisions: number;

	private readonly _sequencer = new SequencerByKey<string>();

	private readonly _lru: ICacheEntry[] = [];

	private _cacheLoadPromise: Promise<void> | undefined;

	constructor(
		userDataPath: URI,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		maxRevisions: number = DEFAULT_MAX_PLUGIN_REVISIONS,
	) {
		this._basePath = URI.joinPath(userDataPath, 'agentPlugins');
		this._cachePath = URI.joinPath(this._basePath, 'cache.json');
		this._maxRevisions = maxRevisions;
	}

	get basePath(): URI {
		return this._basePath;
	}

	async syncCustomizations(
		clientId: string,
		customizations: ClientPluginCustomization[],
		progress?: (status: PluginCustomization) => void,
	): Promise<ISyncedCustomization[]> {
		await this._ensureCacheLoaded();

		const results = await Promise.all(customizations.map(ref =>
			this._sequencer.queue(ref.uri, async (): Promise<ISyncedCustomization> => {
				try {
					const pluginDir = await this._syncPlugin(clientId, ref);
					const customization: PluginCustomization = { ...ref, load: { kind: CustomizationLoadStatus.Loaded } };
					progress?.(customization);
					return { customization, pluginDir };
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					this._logService.error(`[AgentPluginManager] Failed to sync plugin ${ref.uri}: ${message}`);
					const customization: PluginCustomization = { ...ref, load: { kind: CustomizationLoadStatus.Error, message } };
					progress?.(customization);
					return { customization };
				}
			})
		));

		return results;
	}


	private async _syncPlugin(clientId: string, ref: ClientPluginCustomization): Promise<URI> {
		const pluginUri = toAgentClientUri(URI.parse(ref.uri), clientId);
		const destDir = this._dirFor(ref.uri, ref.nonce);

		if (ref.nonce && this._findEntry(ref.uri, ref.nonce) && await this._fileService.exists(destDir)) {
			this._touchLru(ref.uri, ref.nonce);
			this._logService.trace(`[AgentPluginManager] Nonce match for ${ref.uri}, skipping copy`);
			await this._persistCache();
			return destDir;
		}

		this._logService.info(`[AgentPluginManager] Syncing plugin: ${ref.uri} → ${destDir.toString()}`);

		await this._fileService.copy(pluginUri, destDir, true);

		this._removeEntry(ref.uri, ref.nonce);
		this._lru.push({ uri: ref.uri, nonce: ref.nonce ?? '' });

		await this._cleanupStaleNoncesFor(ref.uri);
		await this._evictIfNeeded();
		await this._persistCache();

		return destDir;
	}

	private _keyForUri(uri: string): string {
		return this._sanitize(uri);
	}

	private _keyForNonce(nonce: string | undefined): string {
		return (nonce && this._sanitize(nonce)) || 'default';
	}

	private _sanitize(value: string): string {
		return value.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').substring(0, 128);
	}

	private _dirFor(uri: string, nonce: string | undefined): URI {
		return URI.joinPath(this._basePath, this._keyForUri(uri), this._keyForNonce(nonce));
	}

	private _pluginRootFor(uri: string): URI {
		return URI.joinPath(this._basePath, this._keyForUri(uri));
	}

	private _findEntry(uri: string, nonce: string | undefined): ICacheEntry | undefined {
		const n = nonce ?? '';
		return this._lru.find(entry => entry.uri === uri && entry.nonce === n);
	}

	private _removeEntry(uri: string, nonce: string | undefined): void {
		const entry = this._findEntry(uri, nonce);
		if (entry) {
			this._removeEntryRef(entry);
		}
	}

	private _removeEntryRef(entry: ICacheEntry): void {
		const idx = this._lru.indexOf(entry);
		if (idx !== -1) {
			this._lru.splice(idx, 1);
		}
	}

	private _touchLru(uri: string, nonce: string | undefined): void {
		const entry = this._findEntry(uri, nonce);
		if (entry) {
			this._removeEntryRef(entry);
			this._lru.push(entry);
		}
	}

	private async _tryDeleteDir(dir: URI): Promise<boolean> {
		try {
			await this._fileService.del(dir, { recursive: true });
			return true;
		} catch (err) {
			if (toFileOperationResult(err) === FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}
			this._logService.warn(`[AgentPluginManager] Failed to remove plugin dir ${dir.toString()}`, err);
			return false;
		}
	}

	private async _cleanupStaleNonces(): Promise<void> {
		for (const uri of new Set(this._lru.map(entry => entry.uri))) {
			await this._cleanupStaleNoncesFor(uri);
		}
	}

	private async _cleanupStaleNoncesFor(uri: string): Promise<void> {
		const entries = this._lru.filter(entry => entry.uri === uri);
		const stale = entries.slice(0, -MAX_REVISIONS_PER_PLUGIN);
		for (const entry of stale) {
			this._logService.info(`[AgentPluginManager] Evicting stale nonce ${entry.nonce || 'default'} for plugin: ${uri}`);
			if (await this._tryDeleteDir(this._dirFor(entry.uri, entry.nonce))) {
				this._removeEntryRef(entry);
			}
		}
	}

	private async _evictIfNeeded(): Promise<void> {
		let i = 0;
		while (this._lru.length > this._maxRevisions && i < this._lru.length) {
			const candidate = this._lru[i];
			this._logService.info(`[AgentPluginManager] Evicting revision ${candidate.nonce || 'default'} of plugin: ${candidate.uri}`);
			if (await this._tryDeleteDir(this._dirFor(candidate.uri, candidate.nonce))) {
				this._lru.splice(i, 1);
				if (!this._lru.some(entry => entry.uri === candidate.uri)) {
					await this._tryDeleteDir(this._pluginRootFor(candidate.uri));
				}
			} else {
				i++;
			}
		}
	}


	private _ensureCacheLoaded(): Promise<void> {
		this._cacheLoadPromise ??= this._loadCache();
		return this._cacheLoadPromise;
	}

	private async _loadCache(): Promise<void> {
		try {
			if (!await this._fileService.exists(this._cachePath)) {
				return;
			}
			const content = await this._fileService.readFile(this._cachePath);
			const entries: ICacheEntry[] = JSON.parse(content.value.toString());
			if (!Array.isArray(entries)) {
				return;
			}

			for (const entry of entries) {
				if (typeof entry.uri === 'string' && typeof entry.nonce === 'string') {
					this._lru.push({ uri: entry.uri, nonce: entry.nonce });
				}
			}
			this._logService.trace(`[AgentPluginManager] Loaded ${entries.length} cache entries from disk`);
		} catch (err) {
			this._logService.warn('[AgentPluginManager] Failed to load cache from disk', err);
		}

		await this._pruneMissingEntries();
		await this._cleanupStaleNonces();
		await this._persistCache();
	}

	/**
	 * Drops entries whose directory is gone (deleted out from under us, or a
	 * copy that never completed). Such an entry can never produce a cache hit,
	 * so leaving it in place would waste a per-plugin retention slot and a slot
	 * against the global cap.
	 */
	private async _pruneMissingEntries(): Promise<void> {
		const present = await Promise.all(this._lru.map(async entry => {
			try {
				await this._fileService.stat(this._dirFor(entry.uri, entry.nonce));
				return true;
			} catch (err) {
				return toFileOperationResult(err) !== FileOperationResult.FILE_NOT_FOUND;
			}
		}));
		for (let i = this._lru.length - 1; i >= 0; i--) {
			if (!present[i]) {
				this._logService.trace(`[AgentPluginManager] Dropping cache entry with no directory: ${this._lru[i].uri}`);
				this._lru.splice(i, 1);
			}
		}
	}

	private async _persistCache(): Promise<void> {
		try {
			const entries: ICacheEntry[] = this._lru.map(entry => ({ uri: entry.uri, nonce: entry.nonce }));
			await this._fileService.createFolder(this._basePath);
			await this._fileService.writeFile(this._cachePath, VSBuffer.fromString(JSON.stringify(entries)));
		} catch (err) {
			this._logService.warn('[AgentPluginManager] Failed to persist cache to disk', err);
		}
	}
}
