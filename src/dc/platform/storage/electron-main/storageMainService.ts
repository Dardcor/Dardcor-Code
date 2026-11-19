/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { IStorage } from '../../../base/parts/storage/common/storage.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILifecycleMainService, LifecycleMainPhase, ShutdownReason } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { AbstractStorageService, isProfileUsingDefaultStorage, IStorageService, StorageScope, StorageTarget } from '../common/storage.js';
import { ApplicationStorageMain, ApplicationSharedStorageMain, ProfileStorageMain, InMemoryStorageMain, IStorageMain, IStorageMainOptions, WorkspaceStorageMain, IStorageChangeEvent } from './storageMain.js';
import { IUserDataProfile, IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';
import { IUserDataProfilesMainService } from '../../userDataProfile/electron-main/userDataProfile.js';
import { IAnyWorkspaceIdentifier } from '../../workspace/common/workspace.js';
import { IUriIdentityService } from '../../uriIdentity/common/uriIdentity.js';
import { Schemas } from '../../../base/common/network.js';


export const IStorageMainService = createDecorator<IStorageMainService>('storageMainService');

export interface IProfileStorageChangeEvent extends IStorageChangeEvent {
	readonly storage: IStorageMain;
	readonly profile: IUserDataProfile;
}

export interface IStorageMainService {

	readonly _serviceBrand: undefined;

	readonly applicationStorage: IStorageMain;

	readonly applicationSharedStorage: IStorageMain;

	readonly onDidChangeProfileStorage: Event<IProfileStorageChangeEvent>;

	profileStorage(profile: IUserDataProfile): IStorageMain;

	workspaceStorage(workspace: IAnyWorkspaceIdentifier): IStorageMain;

	isUsed(path: string): boolean;
}

export class StorageMainService extends Disposable implements IStorageMainService {

	declare readonly _serviceBrand: undefined;

	private shutdownReason: ShutdownReason | undefined = undefined;

	private readonly _onDidChangeProfileStorage = this._register(new Emitter<IProfileStorageChangeEvent>());
	readonly onDidChangeProfileStorage = this._onDidChangeProfileStorage.event;

	constructor(
		@ILogService private readonly logService: ILogService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IUserDataProfilesMainService private readonly userDataProfilesService: IUserDataProfilesMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
		super();

		this.applicationStorage = this._register(this.createApplicationStorage());
		this.applicationSharedStorage = this._register(this.createApplicationSharedStorage());

		this.registerListeners();
	}

	protected getStorageOptions(): IStorageMainOptions {
		return {
			useInMemoryStorage: !!this.environmentService.extensionTestsLocationURI
		};
	}

	private registerListeners(): void {

		(async () => {
			await this.lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen);

			this.applicationStorage.init();
			this.applicationSharedStorage.init();
		})();

		this._register(this.lifecycleMainService.onWillLoadWindow(e => {

			if (e.window.profile) {
				this.profileStorage(e.window.profile).init();
			}

			if (e.workspace) {
				this.workspaceStorage(e.workspace).init();
			}
		}));

		this._register(this.lifecycleMainService.onWillShutdown(e => {
			this.logService.trace('storageMainService#onWillShutdown()');

			this.shutdownReason = e.reason;

			e.join('applicationStorage', this.applicationStorage.close());

			e.join('applicationSharedStorage', this.applicationSharedStorage.close());

			for (const [, profileStorage] of this.mapProfileToStorage) {
				e.join('profileStorage', profileStorage.close());
			}

			for (const [, workspaceStorage] of this.mapWorkspaceToStorage) {
				e.join('workspaceStorage', workspaceStorage.close());
			}
		}));

		this._register(this.userDataProfilesService.onWillCreateProfile(e => {
			e.join((async () => {
				if (!(await this.fileService.exists(e.profile.globalStorageHome))) {
					await this.fileService.createFolder(e.profile.globalStorageHome);
				}
			})());
		}));

		this._register(this.userDataProfilesService.onWillRemoveProfile(e => {
			const storage = this.mapProfileToStorage.get(e.profile.id);
			if (storage) {
				e.join(storage.close());
			}
		}));
	}


	readonly applicationStorage: IStorageMain;

	private createApplicationStorage(): IStorageMain {
		this.logService.trace(`StorageMainService: creating application storage`);

		const applicationStorage = new ApplicationStorageMain(this.getStorageOptions(), this.userDataProfilesService, this.logService, this.fileService);

		this._register(Event.once(applicationStorage.onDidCloseStorage)(() => {
			this.logService.trace(`StorageMainService: closed application storage`);
		}));

		return applicationStorage;
	}



	readonly applicationSharedStorage: IStorageMain;

	private createApplicationSharedStorage(): IStorageMain {
		this.logService.info(`StorageMainService: creating application shared storage`);

		const sharedStorageFolderPath = join(this.environmentService.appSharedDataHome.with({ scheme: Schemas.file }).fsPath, 'sharedStorage');

		const applicationSharedStorage = new ApplicationSharedStorageMain(this.getStorageOptions(), sharedStorageFolderPath, this.applicationStorage, this.logService, this.fileService);

		this._register(Event.once(applicationSharedStorage.onDidCloseStorage)(() => {
			this.logService.trace(`StorageMainService: closed application shared storage`);
		}));

		return applicationSharedStorage;
	}



	private readonly mapProfileToStorage = new Map<string , IStorageMain>();

	profileStorage(profile: IUserDataProfile): IStorageMain {
		if (isProfileUsingDefaultStorage(profile)) {
			return this.applicationStorage;
		}

		let profileStorage = this.mapProfileToStorage.get(profile.id);
		if (!profileStorage) {
			this.logService.trace(`StorageMainService: creating profile storage (${profile.name})`);

			profileStorage = this._register(this.createProfileStorage(profile));
			this.mapProfileToStorage.set(profile.id, profileStorage);

			const listener = profileStorage.onDidChangeStorage(e => this._onDidChangeProfileStorage.fire({
				...e,
				storage: profileStorage!,
				profile
			}));

			Event.once(profileStorage.onDidCloseStorage)(() => {
				this.logService.trace(`StorageMainService: closed profile storage (${profile.name})`);

				this.mapProfileToStorage.delete(profile.id);
				listener.dispose();
			});
		}

		return profileStorage;
	}

	private createProfileStorage(profile: IUserDataProfile): IStorageMain {
		if (this.shutdownReason === ShutdownReason.KILL) {


			return new InMemoryStorageMain(this.logService, this.fileService);
		}

		return new ProfileStorageMain(profile, this.getStorageOptions(), this.logService, this.fileService);
	}




	private readonly mapWorkspaceToStorage = new Map<string , IStorageMain>();

	workspaceStorage(workspace: IAnyWorkspaceIdentifier): IStorageMain {
		let workspaceStorage = this.mapWorkspaceToStorage.get(workspace.id);
		if (!workspaceStorage) {
			this.logService.trace(`StorageMainService: creating workspace storage (${workspace.id})`);

			workspaceStorage = this._register(this.createWorkspaceStorage(workspace));
			this.mapWorkspaceToStorage.set(workspace.id, workspaceStorage);

			Event.once(workspaceStorage.onDidCloseStorage)(() => {
				this.logService.trace(`StorageMainService: closed workspace storage (${workspace.id})`);

				this.mapWorkspaceToStorage.delete(workspace.id);
			});
		}

		return workspaceStorage;
	}

	private createWorkspaceStorage(workspace: IAnyWorkspaceIdentifier): IStorageMain {
		if (this.shutdownReason === ShutdownReason.KILL) {


			return new InMemoryStorageMain(this.logService, this.fileService);
		}

		return new WorkspaceStorageMain(workspace, this.getStorageOptions(), this.logService, this.environmentService, this.fileService);
	}


	isUsed(path: string): boolean {
		const pathUri = URI.file(path);

		for (const storage of [this.applicationStorage, this.applicationSharedStorage, ...this.mapProfileToStorage.values(), ...this.mapWorkspaceToStorage.values()]) {
			if (!storage.path) {
				continue;
			}

			if (this.uriIdentityService.extUri.isEqualOrParent(URI.file(storage.path), pathUri)) {
				return true;
			}
		}

		return false;
	}
}




export const IApplicationStorageMainService = createDecorator<IStorageMainService>('applicationStorageMainService');

type ApplicationStorageScope = StorageScope.APPLICATION | StorageScope.APPLICATION_SHARED;

export interface IApplicationStorageMainService extends IStorageService {

	readonly whenReady: Promise<void>;

	get(key: string, scope: ApplicationStorageScope, fallbackValue: string): string;
	get(key: string, scope: ApplicationStorageScope, fallbackValue?: string): string | undefined;

	getBoolean(key: string, scope: ApplicationStorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: ApplicationStorageScope, fallbackValue?: boolean): boolean | undefined;

	getNumber(key: string, scope: ApplicationStorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: ApplicationStorageScope, fallbackValue?: number): number | undefined;

	store(key: string, value: string | boolean | number | undefined | null, scope: ApplicationStorageScope, target: StorageTarget): void;

	remove(key: string, scope: ApplicationStorageScope): void;

	keys(scope: ApplicationStorageScope, target: StorageTarget): string[];

	switch(): never;

	isNew(scope: ApplicationStorageScope): boolean;
}

export class ApplicationStorageMainService extends AbstractStorageService implements IApplicationStorageMainService {

	declare readonly _serviceBrand: undefined;

	readonly whenReady: Promise<void>;

	constructor(
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IStorageMainService private readonly storageMainService: IStorageMainService
	) {
		super();

		this.whenReady = Promise.all([
			this.storageMainService.applicationStorage.whenInit,
			this.storageMainService.applicationSharedStorage.whenInit
		]).then(() => undefined);
	}

	protected doInitialize(): Promise<void> {

		return Promise.all([
			this.storageMainService.applicationStorage.whenInit,
			this.storageMainService.applicationSharedStorage.whenInit
		]).then(() => undefined);
	}

	protected getStorage(scope: StorageScope): IStorage | undefined {
		if (scope === StorageScope.APPLICATION) {
			return this.storageMainService.applicationStorage.storage;
		}

		if (scope === StorageScope.APPLICATION_SHARED) {
			return this.storageMainService.applicationSharedStorage.storage;
		}

		return undefined;
	}

	protected getLogDetails(scope: StorageScope): string | undefined {
		if (scope === StorageScope.APPLICATION) {
			return this.userDataProfilesService.defaultProfile.globalStorageHome.with({ scheme: Schemas.file }).fsPath;
		}

		if (scope === StorageScope.APPLICATION_SHARED) {
			return this.storageMainService.applicationSharedStorage.path;
		}

		return undefined;
	}

	protected override shouldFlushWhenIdle(): boolean {
		return false;
	}

	override switch(): never {
		throw new Error('Migrating storage is unsupported from main process');
	}

	protected switchToProfile(): never {
		throw new Error('Switching storage profile is unsupported from main process');
	}

	protected switchToWorkspace(): never {
		throw new Error('Switching storage workspace is unsupported from main process');
	}

	hasScope(): never {
		throw new Error('Main process is never profile or workspace scoped');
	}
}
