/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Promises, RunOnceScheduler, runWhenGlobalIdle } from '../../../base/common/async.js';
import { Emitter, Event, PauseableEmitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore, dispose, MutableDisposable } from '../../../base/common/lifecycle.js';
import { mark } from '../../../base/common/performance.js';
import { isUndefinedOrNull } from '../../../base/common/types.js';
import { InMemoryStorageDatabase, IStorage, IStorageChangeEvent, Storage, StorageHint, StorageValue } from '../../../base/parts/storage/common/storage.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { isUserDataProfile, IUserDataProfile } from '../../userDataProfile/common/userDataProfile.js';
import { IAnyWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export const IS_NEW_KEY = '__$__isNewStorageMarker';
export const TARGET_KEY = '__$__targetStorageMarker';

export const IStorageService = createDecorator<IStorageService>('storageService');

export enum WillSaveStateReason {

	NONE,

	SHUTDOWN
}

export interface IWillSaveStateEvent {
	readonly reason: WillSaveStateReason;
}

export interface IStorageEntry {
	readonly key: string;
	readonly value: StorageValue;
	readonly scope: StorageScope;
	readonly target: StorageTarget;
}

export interface IWorkspaceStorageValueChangeEvent extends IStorageValueChangeEvent {
	readonly scope: StorageScope.WORKSPACE;
}

export interface IProfileStorageValueChangeEvent extends IStorageValueChangeEvent {
	readonly scope: StorageScope.PROFILE;
}

export interface IApplicationStorageValueChangeEvent extends IStorageValueChangeEvent {
	readonly scope: StorageScope.APPLICATION;
}

export interface IApplicationSharedStorageValueChangeEvent extends IStorageValueChangeEvent {
	readonly scope: StorageScope.APPLICATION_SHARED;
}

export interface IStorageService {

	readonly _serviceBrand: undefined;

	onDidChangeValue(scope: StorageScope.WORKSPACE, key: string | undefined, disposable: DisposableStore): Event<IWorkspaceStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.PROFILE, key: string | undefined, disposable: DisposableStore): Event<IProfileStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.APPLICATION, key: string | undefined, disposable: DisposableStore): Event<IApplicationStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.APPLICATION_SHARED, key: string | undefined, disposable: DisposableStore): Event<IApplicationSharedStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope, key: string | undefined, disposable: DisposableStore): Event<IStorageValueChangeEvent>;

	readonly onDidChangeTarget: Event<IStorageTargetChangeEvent>;

	readonly onWillSaveState: Event<IWillSaveStateEvent>;

	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined;

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined;

	getObject<T extends object>(key: string, scope: StorageScope, fallbackValue: T): T;
	getObject<T extends object>(key: string, scope: StorageScope, fallbackValue?: T): T | undefined;

	store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget): void;

	storeAll(entries: Array<IStorageEntry>, external: boolean): void;

	remove(key: string, scope: StorageScope): void;

	keys(scope: StorageScope, target: StorageTarget): string[];

	log(): void;

	hasScope(scope: IAnyWorkspaceIdentifier | IUserDataProfile): boolean;

	switch(to: IAnyWorkspaceIdentifier | IUserDataProfile, preserveData: boolean): Promise<void>;

	isNew(scope: StorageScope): boolean;

	optimize(scope: StorageScope): Promise<void>;

	flush(reason?: WillSaveStateReason): Promise<void>;
}

export const enum StorageScope {

	APPLICATION_SHARED = -2,

	APPLICATION = -1,

	PROFILE = 0,

	WORKSPACE = 1
}

export const enum StorageTarget {

	USER,

	MACHINE
}

export interface IStorageValueChangeEvent {

	readonly scope: StorageScope;

	readonly key: string;

	readonly target: StorageTarget | undefined;

	readonly external?: boolean;
}

export interface IStorageTargetChangeEvent {

	readonly scope: StorageScope;
}

interface IKeyTargets {
	[key: string]: StorageTarget;
}

export interface IStorageServiceOptions {
	readonly flushInterval: number;
}

export function loadKeyTargets(storage: IStorage): IKeyTargets {
	const keysRaw = storage.get(TARGET_KEY);
	if (keysRaw) {
		try {
			return JSON.parse(keysRaw);
		} catch (error) {
		}
	}

	return Object.create(null);
}

export abstract class AbstractStorageService extends Disposable implements IStorageService {

	declare readonly _serviceBrand: undefined;

	private static DEFAULT_FLUSH_INTERVAL = 60 * 1000;

	private readonly _onDidChangeValue = this._register(new PauseableEmitter<IStorageValueChangeEvent>());

	private readonly _onDidChangeTarget = this._register(new PauseableEmitter<IStorageTargetChangeEvent>());
	readonly onDidChangeTarget = this._onDidChangeTarget.event;

	private readonly _onWillSaveState = this._register(new Emitter<IWillSaveStateEvent>());
	readonly onWillSaveState = this._onWillSaveState.event;

	private initializationPromise: Promise<void> | undefined;

	private readonly flushWhenIdleScheduler: RunOnceScheduler;
	private readonly runFlushWhenIdle = this._register(new MutableDisposable());

	constructor(options: IStorageServiceOptions = { flushInterval: AbstractStorageService.DEFAULT_FLUSH_INTERVAL }) {
		super();

		this.flushWhenIdleScheduler = this._register(new RunOnceScheduler(() => this.doFlushWhenIdle(), options.flushInterval));
	}

	onDidChangeValue(scope: StorageScope.WORKSPACE, key: string | undefined, disposable: DisposableStore): Event<IWorkspaceStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.PROFILE, key: string | undefined, disposable: DisposableStore): Event<IProfileStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.APPLICATION, key: string | undefined, disposable: DisposableStore): Event<IApplicationStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope.APPLICATION_SHARED, key: string | undefined, disposable: DisposableStore): Event<IApplicationSharedStorageValueChangeEvent>;
	onDidChangeValue(scope: StorageScope, key: string | undefined, disposable: DisposableStore): Event<IStorageValueChangeEvent> {
		return Event.filter(this._onDidChangeValue.event, e => e.scope === scope && (key === undefined || e.key === key), disposable);
	}

	private doFlushWhenIdle(): void {
		this.runFlushWhenIdle.value = runWhenGlobalIdle(() => {
			if (this.shouldFlushWhenIdle()) {
				this.flush();
			}

			this.flushWhenIdleScheduler.schedule();
		});
	}

	protected shouldFlushWhenIdle(): boolean {
		return true;
	}

	protected stopFlushWhenIdle(): void {
		dispose([this.runFlushWhenIdle, this.flushWhenIdleScheduler]);
	}

	initialize(): Promise<void> {
		if (!this.initializationPromise) {
			this.initializationPromise = (async () => {

				mark('code/willInitStorage');
				try {
					await this.doInitialize();
				} finally {
					mark('code/didInitStorage');
				}

				this.flushWhenIdleScheduler.schedule();
			})();
		}

		return this.initializationPromise;
	}

	protected emitDidChangeValue(scope: StorageScope, event: IStorageChangeEvent): void {
		const { key, external } = event;

		if (key === TARGET_KEY) {

			switch (scope) {
				case StorageScope.APPLICATION_SHARED:
					this._applicationSharedKeyTargets = undefined;
					break;
				case StorageScope.APPLICATION:
					this._applicationKeyTargets = undefined;
					break;
				case StorageScope.PROFILE:
					this._profileKeyTargets = undefined;
					break;
				case StorageScope.WORKSPACE:
					this._workspaceKeyTargets = undefined;
					break;
			}

			this._onDidChangeTarget.fire({ scope });
		}

		else {
			this._onDidChangeValue.fire({ scope, key, target: this.getKeyTargets(scope)[key], external });
		}
	}

	protected emitWillSaveState(reason: WillSaveStateReason): void {
		this._onWillSaveState.fire({ reason });
	}

	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope): string | undefined;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		return this.getStorage(scope)?.get(key, fallbackValue);
	}

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope): boolean | undefined;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined {
		return this.getStorage(scope)?.getBoolean(key, fallbackValue);
	}

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope): number | undefined;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined {
		return this.getStorage(scope)?.getNumber(key, fallbackValue);
	}

	getObject(key: string, scope: StorageScope, fallbackValue: object): object;
	getObject(key: string, scope: StorageScope): object | undefined;
	getObject(key: string, scope: StorageScope, fallbackValue?: object): object | undefined {
		return this.getStorage(scope)?.getObject(key, fallbackValue);
	}

	storeAll(entries: Array<IStorageEntry>, external: boolean): void {
		this.withPausedEmitters(() => {
			for (const entry of entries) {
				this.store(entry.key, entry.value, entry.scope, entry.target, external);
			}
		});
	}

	store(key: string, value: StorageValue, scope: StorageScope, target: StorageTarget, external = false): void {

		if (isUndefinedOrNull(value)) {
			this.remove(key, scope, external);
			return;
		}

		this.withPausedEmitters(() => {

			this.updateKeyTarget(key, scope, target);

			this.getStorage(scope)?.set(key, value, external);
		});
	}

	remove(key: string, scope: StorageScope, external = false): void {

		this.withPausedEmitters(() => {

			this.updateKeyTarget(key, scope, undefined);

			this.getStorage(scope)?.delete(key, external);
		});
	}

	private withPausedEmitters(fn: Function): void {

		this._onDidChangeValue.pause();
		this._onDidChangeTarget.pause();

		try {
			fn();
		} finally {

			this._onDidChangeValue.resume();
			this._onDidChangeTarget.resume();
		}
	}

	keys(scope: StorageScope, target: StorageTarget): string[] {
		const keys: string[] = [];

		const keyTargets = this.getKeyTargets(scope);
		for (const key of Object.keys(keyTargets)) {
			const keyTarget = keyTargets[key];
			if (keyTarget === target) {
				keys.push(key);
			}
		}

		return keys;
	}

	private updateKeyTarget(key: string, scope: StorageScope, target: StorageTarget | undefined, external = false): void {

		const keyTargets = this.getKeyTargets(scope);
		if (typeof target === 'number') {
			if (keyTargets[key] !== target) {
				keyTargets[key] = target;
				this.getStorage(scope)?.set(TARGET_KEY, JSON.stringify(keyTargets), external);
			}
		}

		else {
			if (typeof keyTargets[key] === 'number') {
				delete keyTargets[key];
				this.getStorage(scope)?.set(TARGET_KEY, JSON.stringify(keyTargets), external);
			}
		}
	}

	private _workspaceKeyTargets: IKeyTargets | undefined = undefined;
	private get workspaceKeyTargets(): IKeyTargets {
		if (!this._workspaceKeyTargets) {
			this._workspaceKeyTargets = this.loadKeyTargets(StorageScope.WORKSPACE);
		}

		return this._workspaceKeyTargets;
	}

	private _profileKeyTargets: IKeyTargets | undefined = undefined;
	private get profileKeyTargets(): IKeyTargets {
		if (!this._profileKeyTargets) {
			this._profileKeyTargets = this.loadKeyTargets(StorageScope.PROFILE);
		}

		return this._profileKeyTargets;
	}

	private _applicationKeyTargets: IKeyTargets | undefined = undefined;
	private get applicationKeyTargets(): IKeyTargets {
		if (!this._applicationKeyTargets) {
			this._applicationKeyTargets = this.loadKeyTargets(StorageScope.APPLICATION);
		}

		return this._applicationKeyTargets;
	}

	private _applicationSharedKeyTargets: IKeyTargets | undefined = undefined;
	private get applicationSharedKeyTargets(): IKeyTargets {
		if (!this._applicationSharedKeyTargets) {
			this._applicationSharedKeyTargets = this.loadKeyTargets(StorageScope.APPLICATION_SHARED);
		}

		return this._applicationSharedKeyTargets;
	}

	private getKeyTargets(scope: StorageScope): IKeyTargets {
		switch (scope) {
			case StorageScope.APPLICATION_SHARED:
				return this.applicationSharedKeyTargets;
			case StorageScope.APPLICATION:
				return this.applicationKeyTargets;
			case StorageScope.PROFILE:
				return this.profileKeyTargets;
			default:
				return this.workspaceKeyTargets;
		}
	}

	private loadKeyTargets(scope: StorageScope): { [key: string]: StorageTarget } {
		const storage = this.getStorage(scope);

		return storage ? loadKeyTargets(storage) : Object.create(null);
	}

	isNew(scope: StorageScope): boolean {
		return this.getBoolean(IS_NEW_KEY, scope) === true;
	}

	async flush(reason = WillSaveStateReason.NONE): Promise<void> {

		this._onWillSaveState.fire({ reason });

		const applicationStorage = this.getStorage(StorageScope.APPLICATION);
		const applicationSharedStorage = this.getStorage(StorageScope.APPLICATION_SHARED);
		const profileStorage = this.getStorage(StorageScope.PROFILE);
		const workspaceStorage = this.getStorage(StorageScope.WORKSPACE);

		switch (reason) {

			case WillSaveStateReason.NONE:
				await Promises.settled([
					applicationStorage?.whenFlushed() ?? Promise.resolve(),
					applicationSharedStorage?.whenFlushed() ?? Promise.resolve(),
					profileStorage?.whenFlushed() ?? Promise.resolve(),
					workspaceStorage?.whenFlushed() ?? Promise.resolve()
				]);
				break;

			case WillSaveStateReason.SHUTDOWN:
				await Promises.settled([
					applicationStorage?.flush(0) ?? Promise.resolve(),
					applicationSharedStorage?.flush(0) ?? Promise.resolve(),
					profileStorage?.flush(0) ?? Promise.resolve(),
					workspaceStorage?.flush(0) ?? Promise.resolve()
				]);
				break;
		}
	}

	async log(): Promise<void> {
		const applicationItems = this.getStorage(StorageScope.APPLICATION)?.items ?? new Map<string, string>();
		const applicationSharedItems = this.getStorage(StorageScope.APPLICATION_SHARED)?.items ?? new Map<string, string>();
		const profileItems = this.getStorage(StorageScope.PROFILE)?.items ?? new Map<string, string>();
		const workspaceItems = this.getStorage(StorageScope.WORKSPACE)?.items ?? new Map<string, string>();

		return logStorage(
			applicationItems,
			applicationSharedItems,
			profileItems,
			workspaceItems,
			this.getLogDetails(StorageScope.APPLICATION) ?? '',
			this.getLogDetails(StorageScope.APPLICATION_SHARED) ?? '',
			this.getLogDetails(StorageScope.PROFILE) ?? '',
			this.getLogDetails(StorageScope.WORKSPACE) ?? ''
		);
	}

	async optimize(scope: StorageScope): Promise<void> {

		await this.flush();

		return this.getStorage(scope)?.optimize();
	}

	async switch(to: IAnyWorkspaceIdentifier | IUserDataProfile, preserveData: boolean): Promise<void> {

		this.emitWillSaveState(WillSaveStateReason.NONE);

		if (isUserDataProfile(to)) {
			return this.switchToProfile(to, preserveData);
		}

		return this.switchToWorkspace(to, preserveData);
	}

	protected canSwitchProfile(from: IUserDataProfile, to: IUserDataProfile): boolean {
		if (from.id === to.id) {
			return false;
		}

		if (isProfileUsingDefaultStorage(to) && isProfileUsingDefaultStorage(from)) {
			return false;
		}

		return true;
	}

	protected switchData(oldStorage: Map<string, string>, newStorage: IStorage, scope: StorageScope): void {
		this.withPausedEmitters(() => {
			const handledkeys = new Set<string>();
			for (const [key, oldValue] of oldStorage) {
				handledkeys.add(key);

				const newValue = newStorage.get(key);
				if (newValue !== oldValue) {
					this.emitDidChangeValue(scope, { key, external: true });
				}
			}

			for (const [key] of newStorage.items) {
				if (!handledkeys.has(key)) {
					this.emitDidChangeValue(scope, { key, external: true });
				}
			}
		});
	}


	abstract hasScope(scope: IAnyWorkspaceIdentifier | IUserDataProfile): boolean;

	protected abstract doInitialize(): Promise<void>;

	protected abstract getStorage(scope: StorageScope): IStorage | undefined;

	protected abstract getLogDetails(scope: StorageScope): string | undefined;

	protected abstract switchToProfile(toProfile: IUserDataProfile, preserveData: boolean): Promise<void>;
	protected abstract switchToWorkspace(toWorkspace: IAnyWorkspaceIdentifier | IUserDataProfile, preserveData: boolean): Promise<void>;
}

export function isProfileUsingDefaultStorage(profile: IUserDataProfile): boolean {
	return profile.isDefault || !!profile.useDefaultFlags?.globalState;
}

export class InMemoryStorageService extends AbstractStorageService {

	private readonly applicationStorage = this._register(new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY }));
	private readonly applicationSharedStorage = this._register(new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY }));
	private readonly profileStorage = this._register(new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY }));
	private readonly workspaceStorage = this._register(new Storage(new InMemoryStorageDatabase(), { hint: StorageHint.STORAGE_IN_MEMORY }));

	constructor() {
		super();

		this._register(this.workspaceStorage.onDidChangeStorage(e => this.emitDidChangeValue(StorageScope.WORKSPACE, e)));
		this._register(this.profileStorage.onDidChangeStorage(e => this.emitDidChangeValue(StorageScope.PROFILE, e)));
		this._register(this.applicationStorage.onDidChangeStorage(e => this.emitDidChangeValue(StorageScope.APPLICATION, e)));
		this._register(this.applicationSharedStorage.onDidChangeStorage(e => this.emitDidChangeValue(StorageScope.APPLICATION_SHARED, e)));
	}

	protected getStorage(scope: StorageScope): IStorage {
		switch (scope) {
			case StorageScope.APPLICATION_SHARED:
				return this.applicationSharedStorage;
			case StorageScope.APPLICATION:
				return this.applicationStorage;
			case StorageScope.PROFILE:
				return this.profileStorage;
			default:
				return this.workspaceStorage;
		}
	}

	protected getLogDetails(scope: StorageScope): string | undefined {
		switch (scope) {
			case StorageScope.APPLICATION_SHARED:
				return 'inMemory (application-shared)';
			case StorageScope.APPLICATION:
				return 'inMemory (application)';
			case StorageScope.PROFILE:
				return 'inMemory (profile)';
			default:
				return 'inMemory (workspace)';
		}
	}

	protected async doInitialize(): Promise<void> { }

	protected async switchToProfile(): Promise<void> {
	}

	protected async switchToWorkspace(): Promise<void> {
	}

	protected override shouldFlushWhenIdle(): boolean {
		return false;
	}

	hasScope(scope: IAnyWorkspaceIdentifier | IUserDataProfile): boolean {
		return false;
	}
}

export async function logStorage(application: Map<string, string>, applicationShared: Map<string, string>, profile: Map<string, string>, workspace: Map<string, string>, applicationPath: string, applicationSharedPath: string, profilePath: string, workspacePath: string): Promise<void> {
	const safeParse = (value: string) => {
		try {
			return JSON.parse(value);
		} catch (error) {
			return value;
		}
	};

	const applicationItems = new Map<string, string>();
	const applicationItemsParsed = new Map<string, string>();
	application.forEach((value, key) => {
		applicationItems.set(key, value);
		applicationItemsParsed.set(key, safeParse(value));
	});

	const applicationSharedItems = new Map<string, string>();
	const applicationSharedItemsParsed = new Map<string, string>();
	applicationShared.forEach((value, key) => {
		applicationSharedItems.set(key, value);
		applicationSharedItemsParsed.set(key, safeParse(value));
	});

	const profileItems = new Map<string, string>();
	const profileItemsParsed = new Map<string, string>();
	profile.forEach((value, key) => {
		profileItems.set(key, value);
		profileItemsParsed.set(key, safeParse(value));
	});

	const workspaceItems = new Map<string, string>();
	const workspaceItemsParsed = new Map<string, string>();
	workspace.forEach((value, key) => {
		workspaceItems.set(key, value);
		workspaceItemsParsed.set(key, safeParse(value));
	});

	if (applicationPath !== profilePath) {
		console.group(`Storage: Application (path: ${applicationPath})`);
	} else {
		console.group(`Storage: Application & Profile (path: ${applicationPath}, default profile)`);
	}
	const applicationValues: { key: string; value: string }[] = [];
	applicationItems.forEach((value, key) => {
		applicationValues.push({ key, value });
	});
	console.table(applicationValues);
	console.groupEnd();

	console.log(applicationItemsParsed);

	console.group(`Storage: Application Shared (path: ${applicationSharedPath})`);
	const applicationSharedValues: { key: string; value: string }[] = [];
	applicationSharedItems.forEach((value, key) => {
		applicationSharedValues.push({ key, value });
	});
	console.table(applicationSharedValues);
	console.groupEnd();

	console.log(applicationSharedItemsParsed);

	if (applicationPath !== profilePath) {
		console.group(`Storage: Profile (path: ${profilePath}, profile specific)`);
		const profileValues: { key: string; value: string }[] = [];
		profileItems.forEach((value, key) => {
			profileValues.push({ key, value });
		});
		console.table(profileValues);
		console.groupEnd();

		console.log(profileItemsParsed);
	}

	console.group(`Storage: Workspace (path: ${workspacePath})`);
	const workspaceValues: { key: string; value: string }[] = [];
	workspaceItems.forEach((value, key) => {
		workspaceValues.push({ key, value });
	});
	console.table(workspaceValues);
	console.groupEnd();

	console.log(workspaceItemsParsed);
}
