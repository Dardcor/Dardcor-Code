/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler, ThrottledDelayer } from '../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { revive } from '../../../../../base/common/marshalling.js';
import { IObservable, ITransaction, observableValue } from '../../../../../base/common/observable.js';
import { isEqual, joinPath } from '../../../../../base/common/resources.js';
import { URI, UriComponents } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope } from '../../../../../platform/storage/common/storage.js';

const INSTALLED_JSON_FILENAME = 'installed.json';
const INSTALLED_JSON_VERSION = 1;

const LEGACY_INSTALLED_PLUGINS_STORAGE_KEY = 'chat.plugins.installed.v1';
const LEGACY_MARKETPLACE_INDEX_STORAGE_KEY = 'chat.plugins.marketplaces.index.v1';

interface IInstalledJsonEntry {
	readonly pluginUri: string;
	readonly marketplace: string;
	readonly name?: string;
}

interface IInstalledJson {
	readonly version: number;
	readonly installed: readonly IInstalledJsonEntry[];
}

export interface IStoredInstalledPlugin {
	readonly pluginUri: URI;
	readonly marketplace: string;
	readonly name?: string;
}

export class FileBackedInstalledPluginsStore extends Disposable {
	private readonly _installed = observableValue<readonly IStoredInstalledPlugin[]>('file/installed.json', []);
	private readonly _fileUri: URI;
	private readonly _writeDelayer: ThrottledDelayer<void>;
	private _suppressFileWatch = false;
	private _initialized = false;

	readonly value: IObservable<readonly IStoredInstalledPlugin[]> = this._installed;

	constructor(
		private readonly _agentPluginsHome: URI,
		private readonly _oldCacheRoot: URI | undefined,
		private readonly _fileService: IFileService,
		private readonly _logService: ILogService,
		private readonly _storageService: IStorageService,
	) {
		super();
		this._fileUri = joinPath(_agentPluginsHome, INSTALLED_JSON_FILENAME);
		this._writeDelayer = this._register(new ThrottledDelayer<void>(100));
		void this._initialize();
	}

	get(): readonly IStoredInstalledPlugin[] {
		return this._installed.get();
	}

	set(newValue: readonly IStoredInstalledPlugin[], tx: ITransaction | undefined): void {
		this._setValue(newValue, tx, true);
	}

	private async _initialize(): Promise<void> {
		try {
			const read = await this._readFromFile();
			if (read !== undefined) {
				this._setValue(read, undefined, false);
			} else {
				await this._migrateFromStorage();
			}
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Initialization failed', error);
		}

		this._initialized = true;
		this._setupFileWatcher();
	}


	private async _readFromFile(): Promise<readonly IStoredInstalledPlugin[] | undefined> {
		try {
			const exists = await this._fileService.exists(this._fileUri);
			if (!exists) {
				return undefined;
			}

			const content = await this._fileService.readFile(this._fileUri);
			const json: IInstalledJson = JSON.parse(content.value.toString());
			if (!json || !Array.isArray(json.installed)) {
				this._logService.warn('[FileBackedInstalledPluginsStore] installed.json has unexpected format, ignoring');
				return undefined;
			}

			return json.installed
				.filter((entry): entry is IInstalledJsonEntry => typeof entry.pluginUri === 'string' && typeof entry.marketplace === 'string')
				.map(entry => ({
					pluginUri: URI.parse(entry.pluginUri),
					marketplace: entry.marketplace,
					name: typeof entry.name === 'string' ? entry.name : undefined,
				}));
		} catch {
			return undefined;
		}
	}

	private _scheduleWrite(): void {
		void this._writeDelayer.trigger(async () => {
			await this._writeToFile();
		});
	}

	private async _writeToFile(): Promise<boolean> {
		const entries: IInstalledJsonEntry[] = this.get().map(e => ({
			pluginUri: e.pluginUri.toString(),
			marketplace: e.marketplace,
			...(e.name ? { name: e.name } : {}),
		}));

		const data: IInstalledJson = {
			version: INSTALLED_JSON_VERSION,
			installed: entries,
		};

		try {
			this._suppressFileWatch = true;
			const content = JSON.stringify(data, undefined, '\t');
			await this._fileService.createFolder(this._agentPluginsHome);
			await this._fileService.writeFile(this._fileUri, VSBuffer.fromString(content));
			return true;
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Failed to write installed.json', error);
			return false;
		} finally {
			this._suppressFileWatch = false;
		}
	}


	private _setupFileWatcher(): void {
		if (typeof this._fileService.createWatcher !== 'function') {
			return;
		}
		const dir = this._agentPluginsHome;
		const watcher = this._fileService.createWatcher(dir, { recursive: false, excludes: [] });
		this._register(watcher);

		const scheduler = this._register(new RunOnceScheduler(() => this._onFileChanged(), 100));
		this._register(watcher.onDidChange(e => {
			if (!this._suppressFileWatch && e.affects(this._fileUri)) {
				scheduler.schedule();
			}
		}));
	}

	private async _onFileChanged(): Promise<void> {
		const read = await this._readFromFile();
		if (read !== undefined) {
			this._suppressFileWatch = true;
			try {
				this._setValue(read, undefined, false);
			} finally {
				this._suppressFileWatch = false;
			}
		}
	}


	private _setValue(newValue: readonly IStoredInstalledPlugin[], tx: ITransaction | undefined, scheduleWrite: boolean): void {
		this._installed.set(newValue, tx);
		if (scheduleWrite && this._initialized && !this._suppressFileWatch) {
			this._scheduleWrite();
		}
	}


	private async _migrateFromStorage(): Promise<void> {
		const raw = this._storageService.get(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION);
		if (!raw) {
			return;
		}

		try {
			const parsed = JSON.parse(raw);
			if (!Array.isArray(parsed) || parsed.length === 0) {
				return;
			}

			const migrated: IStoredInstalledPlugin[] = (revive(parsed) as { pluginUri: UriComponents; plugin?: { name?: string; marketplaceReference?: { rawValue?: string } } }[]).map(entry => {
				const uri = URI.revive(entry.pluginUri);
				const rebased = this._rebasePluginUri(uri);
				return {
					pluginUri: rebased ?? uri,
					marketplace: entry.plugin?.marketplaceReference?.rawValue ?? '',
					name: entry.plugin?.name,
				};
			}).filter(e => !!e.marketplace);

			this._logService.info(`[FileBackedInstalledPluginsStore] Migrating ${migrated.length} plugin(s) from storage to installed.json`);

			this._setValue(migrated, undefined, false);
			const didPersist = await this._writeToFile();
			if (!didPersist) {
				return;
			}

			this._storageService.remove(LEGACY_INSTALLED_PLUGINS_STORAGE_KEY, StorageScope.APPLICATION);
			this._storageService.remove(LEGACY_MARKETPLACE_INDEX_STORAGE_KEY, StorageScope.APPLICATION);
		} catch (error) {
			this._logService.error('[FileBackedInstalledPluginsStore] Migration from storage failed', error);
		}
	}

	private _rebasePluginUri(uri: URI): URI | undefined {
		if (!this._oldCacheRoot) {
			return undefined;
		}

		const oldRoot = this._oldCacheRoot;
		if (!isEqual(uri, oldRoot) && uri.scheme === oldRoot.scheme && uri.path.startsWith(oldRoot.path + '/')) {
			const relativePart = uri.path.substring(oldRoot.path.length);
			return uri.with({ path: this._agentPluginsHome.path + relativePart });
		}
		return undefined;
	}
}
