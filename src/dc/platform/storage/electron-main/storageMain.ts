/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { top } from '../../../base/common/arrays.js';
import { DeferredPromise } from '../../../base/common/async.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { URI } from '../../../base/common/uri.js';
import { Promises } from '../../../base/node/pfs.js';
import { InMemoryStorageDatabase, IStorage, Storage, StorageHint, StorageState } from '../../../base/parts/storage/common/storage.js';
import { ISQLiteStorageDatabaseLoggingOptions, SQLiteStorageDatabase } from '../../../base/parts/storage/node/storage.js';
import { IEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService, LogLevel } from '../../log/common/log.js';
import { IS_NEW_KEY } from '../common/storage.js';
import { IUserDataProfile, IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';
import { currentSessionDateStorageKey, firstSessionDateStorageKey, lastSessionDateStorageKey } from '../../telemetry/common/telemetry.js';
import { isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IAnyWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { Schemas } from '../../../base/common/network.js';

export interface IStorageMainOptions {

	readonly useInMemoryStorage?: boolean;
}

export interface IStorageMain extends IDisposable {

	readonly onDidChangeStorage: Event<IStorageChangeEvent>;

	readonly onDidCloseStorage: Event<void>;

	readonly items: Map<string, string>;

	readonly whenInit: Promise<void>;

	readonly storage: IStorage;

	readonly path: string | undefined;

	init(): Promise<void>;

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	set(key: string, value: string | boolean | number | undefined | null): void;

	delete(key: string): void;

	isInMemory(): boolean;

	optimize(): Promise<void>;

	close(): Promise<void>;
}

export interface IStorageChangeEvent {
	readonly key: string;
}

abstract class BaseStorageMain extends Disposable implements IStorageMain {

	private static readonly LOG_SLOW_CLOSE_THRESHOLD = 2000;

	protected readonly _onDidChangeStorage = this._register(new Emitter<IStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private readonly _onDidCloseStorage = this._register(new Emitter<void>());
	readonly onDidCloseStorage = this._onDidCloseStorage.event;

	private _storage = this._register(new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY }));
	get storage(): IStorage { return this._storage; }

	abstract get path(): string | undefined;

	private initializePromise: Promise<void> | undefined = undefined;

	private readonly whenInitPromise = new DeferredPromise<void>();
	readonly whenInit = this.whenInitPromise.p;

	private state = StorageState.None;

	constructor(
		protected readonly logService: ILogService,
		private readonly fileService: IFileService
	) {
		super();
	}

	isInMemory(): boolean {
		return this._storage.isInMemory();
	}

	init(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = (async () => {
				if (this.state !== StorageState.None) {
					return;
				}

				try {

					const storage = this._register(await this.doCreate());

					this._storage.dispose();
					this._storage = storage;

					this._register(storage.onDidChangeStorage(e => this._onDidChangeStorage.fire(e)));

					await this.doInit(storage);

					const isNewStorage = storage.getBoolean(IS_NEW_KEY);
					if (isNewStorage === undefined) {
						storage.set(IS_NEW_KEY, true);
					} else if (isNewStorage) {
						storage.set(IS_NEW_KEY, false);
					}
				} catch (error) {
					this.logService.error(`[storage main] initialize(): Unable to init storage due to ${error}`);
				} finally {

					this.state = StorageState.Initialized;

					this.whenInitPromise.complete();
				}
			})();
		}

		return this.initializePromise;
	}

	protected createLoggingOptions(): ISQLiteStorageDatabaseLoggingOptions {
		return {
			logTrace: (this.logService.getLevel() === LogLevel.Trace) ? msg => this.logService.trace(msg) : undefined,
			logError: error => this.logService.error(error)
		};
	}

	protected doInit(storage: IStorage): Promise<void> {
		return storage.init();
	}

	protected abstract doCreate(): Promise<Storage>;

	get items(): Map<string, string> { return this._storage.items; }

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		return this._storage.get(key, fallbackValue);
	}

	set(key: string, value: string | boolean | number | undefined | null): Promise<void> {
		return this._storage.set(key, value);
	}

	delete(key: string): Promise<void> {
		return this._storage.delete(key);
	}

	optimize(): Promise<void> {
		return this._storage.optimize();
	}

	async close(): Promise<void> {

		const watch = new StopWatch(false);
		await this.doClose();
		watch.stop();

		if (watch.elapsed() > BaseStorageMain.LOG_SLOW_CLOSE_THRESHOLD) {
			await this.logSlowClose(watch);
		}

		this._onDidCloseStorage.fire();
	}

	private async logSlowClose(watch: StopWatch) {
		if (!this.path) {
			return;
		}

		try {
			const largestEntries = top(Array.from(this._storage.items.entries())
				.map(([key, value]) => ({ key, length: value.length })), (entryA, entryB) => entryB.length - entryA.length, 5)
				.map(entry => `${entry.key}:${entry.length}`).join(', ');
			const dbSize = (await this.fileService.stat(URI.file(this.path))).size;

			this.logService.warn(`[storage main] detected slow close() operation: Time: ${watch.elapsed()}ms, DB size: ${dbSize}b, Large Keys: ${largestEntries}`);
		} catch (error) {
			this.logService.error('[storage main] figuring out stats for slow DB on close() resulted in an error', error);
		}
	}

	private async doClose(): Promise<void> {

		if (this.initializePromise) {
			await this.initializePromise;
		}

		this.state = StorageState.Closed;

		await this._storage.close();
	}
}

class BaseProfileAwareStorageMain extends BaseStorageMain {

	private static readonly STORAGE_NAME = 'state.vscdb';

	get path(): string | undefined {
		if (!this.options.useInMemoryStorage) {
			return join(this.profile.globalStorageHome.with({ scheme: Schemas.file }).fsPath, BaseProfileAwareStorageMain.STORAGE_NAME);
		}

		return undefined;
	}

	constructor(
		private readonly profile: IUserDataProfile,
		private readonly options: IStorageMainOptions,
		logService: ILogService,
		fileService: IFileService
	) {
		super(logService, fileService);
	}

	protected async doCreate(): Promise<Storage> {
		return new Storage(new SQLiteStorageDatabase(this.path ?? SQLiteStorageDatabase.IN_MEMORY_PATH, {
			logging: this.createLoggingOptions()
		}), !this.path ? { hint: StorageHint.STORAGE_IN_MEMORY } : undefined);
	}
}

export class ProfileStorageMain extends BaseProfileAwareStorageMain {

}

export class ApplicationStorageMain extends BaseProfileAwareStorageMain {

	constructor(
		options: IStorageMainOptions,
		userDataProfileService: IUserDataProfilesService,
		logService: ILogService,
		fileService: IFileService
	) {
		super(userDataProfileService.defaultProfile, options, logService, fileService);
	}

	protected override async doInit(storage: IStorage): Promise<void> {
		await super.doInit(storage);

		this.updateTelemetryState(storage);
	}

	private updateTelemetryState(storage: IStorage): void {

		const firstSessionDate = storage.get(firstSessionDateStorageKey, undefined);
		if (firstSessionDate === undefined) {
			storage.set(firstSessionDateStorageKey, new Date().toUTCString());
		}

		const lastSessionDate = storage.get(currentSessionDateStorageKey, undefined);
		const currentSessionDate = new Date().toUTCString();
		storage.set(lastSessionDateStorageKey, typeof lastSessionDate === 'undefined' ? null : lastSessionDate);
		storage.set(currentSessionDateStorageKey, currentSessionDate);
	}
}

export class ApplicationSharedStorageMain extends BaseStorageMain {

	private static readonly STORAGE_NAME = 'state.dcdb';

	get path(): string | undefined {
		if (!this.options.useInMemoryStorage) {
			return join(this.storageFolderPath, ApplicationSharedStorageMain.STORAGE_NAME);
		}

		return undefined;
	}

	constructor(
		private readonly options: IStorageMainOptions,
		private readonly storageFolderPath: string,
		private readonly _applicationStorage: IStorageMain,
		logService: ILogService,
		fileService: IFileService,
	) {
		super(logService, fileService);
	}

	protected async doCreate(): Promise<Storage> {
		const { storageFilePath, wasCreated } = await this.prepareStorageFolder();

		this.logService.info(`[shared storage] Creating shared storage database at '${storageFilePath}' (wasCreated: ${wasCreated})`);

		const database = new SQLiteStorageDatabase(storageFilePath, {
			logging: this.createLoggingOptions()
		});

		return this._register(new Storage(database, { hint: wasCreated ? StorageHint.STORAGE_DOES_NOT_EXIST : undefined }));
	}

	get applicationStorageItems(): Map<string, string> {
		return this._applicationStorage.items;
	}

	private async prepareStorageFolder(): Promise<{ storageFilePath: string; wasCreated: boolean }> {
		if (this.options.useInMemoryStorage) {
			return { storageFilePath: SQLiteStorageDatabase.IN_MEMORY_PATH, wasCreated: true };
		}

		const storageDatabasePath = join(this.storageFolderPath, ApplicationSharedStorageMain.STORAGE_NAME);
		const legacyDatabasePath = join(this.storageFolderPath, 'state.vscdb');
		const appStoragePath = this._applicationStorage.path;

		const folderExists = await Promises.exists(this.storageFolderPath);
		if (!folderExists) {
			await fs.promises.mkdir(this.storageFolderPath, { recursive: true });
		}

		let databaseExists = await Promises.exists(storageDatabasePath);
		if (!databaseExists) {
			if (await Promises.exists(legacyDatabasePath)) {
				try {
					await fs.promises.copyFile(legacyDatabasePath, storageDatabasePath);
					databaseExists = true;
				} catch (error) {
					this.logService.error(`[shared storage] Failed to copy legacy database from ${legacyDatabasePath} to ${storageDatabasePath}:`, error);
				}
			} else if (appStoragePath && await Promises.exists(appStoragePath)) {
				try {
					await fs.promises.copyFile(appStoragePath, storageDatabasePath);
					databaseExists = true;
				} catch (error) {
					this.logService.error(`[shared storage] Failed to copy legacy database from ${appStoragePath} to ${storageDatabasePath}:`, error);
				}
			}
		}

		return { storageFilePath: storageDatabasePath, wasCreated: !databaseExists };
	}
}

export class WorkspaceStorageMain extends BaseStorageMain {

	private static readonly WORKSPACE_STORAGE_NAME = 'state.vscdb';
	private static readonly WORKSPACE_META_NAME = 'workspace.json';

	get path(): string | undefined {
		if (!this.options.useInMemoryStorage) {
			return join(this.environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath, this.workspace.id, WorkspaceStorageMain.WORKSPACE_STORAGE_NAME);
		}

		return undefined;
	}

	constructor(
		private workspace: IAnyWorkspaceIdentifier,
		private readonly options: IStorageMainOptions,
		logService: ILogService,
		private readonly environmentService: IEnvironmentService,
		fileService: IFileService
	) {
		super(logService, fileService);
	}

	protected async doCreate(): Promise<Storage> {
		const { storageFilePath, wasCreated } = await this.prepareWorkspaceStorageFolder();

		return new Storage(new SQLiteStorageDatabase(storageFilePath, {
			logging: this.createLoggingOptions()
		}), { hint: this.options.useInMemoryStorage ? StorageHint.STORAGE_IN_MEMORY : wasCreated ? StorageHint.STORAGE_DOES_NOT_EXIST : undefined });
	}

	private async prepareWorkspaceStorageFolder(): Promise<{ storageFilePath: string; wasCreated: boolean }> {

		if (this.options.useInMemoryStorage) {
			return { storageFilePath: SQLiteStorageDatabase.IN_MEMORY_PATH, wasCreated: true };
		}

		const workspaceStorageFolderPath = join(this.environmentService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath, this.workspace.id);
		const workspaceStorageDatabasePath = join(workspaceStorageFolderPath, WorkspaceStorageMain.WORKSPACE_STORAGE_NAME);

		const storageExists = await Promises.exists(workspaceStorageFolderPath);
		if (storageExists) {
			return { storageFilePath: workspaceStorageDatabasePath, wasCreated: false };
		}

		await fs.promises.mkdir(workspaceStorageFolderPath, { recursive: true });

		this.ensureWorkspaceStorageFolderMeta(workspaceStorageFolderPath);

		return { storageFilePath: workspaceStorageDatabasePath, wasCreated: true };
	}

	private async ensureWorkspaceStorageFolderMeta(workspaceStorageFolderPath: string): Promise<void> {
		let meta: object | undefined = undefined;
		if (isSingleFolderWorkspaceIdentifier(this.workspace)) {
			meta = { folder: this.workspace.uri.toString() };
		} else if (isWorkspaceIdentifier(this.workspace)) {
			meta = { workspace: this.workspace.configPath.toString() };
		}

		if (meta) {
			try {
				const workspaceStorageMetaPath = join(workspaceStorageFolderPath, WorkspaceStorageMain.WORKSPACE_META_NAME);
				const storageExists = await Promises.exists(workspaceStorageMetaPath);
				if (!storageExists) {
					await Promises.writeFile(workspaceStorageMetaPath, JSON.stringify(meta, undefined, 2));
				}
			} catch (error) {
				this.logService.error(`[storage main] ensureWorkspaceStorageFolderMeta(): Unable to create workspace storage metadata due to ${error}`);
			}
		}
	}
}

export class InMemoryStorageMain extends BaseStorageMain {

	get path(): string | undefined {
		return undefined;
	}

	protected async doCreate(): Promise<Storage> {
		return new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY });
	}
}
