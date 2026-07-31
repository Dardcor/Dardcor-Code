/**
 * Dardcor Code - User Data Sync Service (Task 149)
 * Mirrors: vs/platform/userDataSync/common/userDataSync.ts (settings & extension cloud sync client)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { mergeSettings } from './sync-merger';

export const enum SyncStatus {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	Syncing = 'syncing',
	HasConflicts = 'hasConflicts',
}

export const IUserDataSyncService = createDecorator<IUserDataSyncService>('userDataSyncService');

export interface IRemoteSyncStore {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
}

export interface IUserDataSyncService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeStatus: Event<SyncStatus>;
	readonly status: SyncStatus;
	sync(): Promise<void>;
}

const SYNC_KEYS = ['settings.json', 'keybindings.json', 'extensions.json'];

export class UserDataSyncService extends Disposable implements IUserDataSyncService {
	declare readonly _serviceBrand: undefined;

	private _status: SyncStatus = SyncStatus.Idle;
	private readonly _local: Map<string, string> = new Map();

	private readonly _onDidChangeStatus = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangeStatus.event;

	constructor(private readonly _remoteStore?: IRemoteSyncStore) {
		super();
	}

	get status(): SyncStatus {
		return this._status;
	}

	setLocal(key: string, value: string): void {
		this._local.set(key, value);
	}

	getLocal(key: string): string | undefined {
		return this._local.get(key);
	}

	async sync(): Promise<void> {
		if (this._status === SyncStatus.Syncing) {
			return;
		}
		this._setStatus(SyncStatus.Syncing);
		let hasConflicts = false;
		try {
			if (this._remoteStore) {
				for (const key of SYNC_KEYS) {
					const localJson = this._local.get(key) ?? '{}';
					const remoteJson = (await this._remoteStore.get(key)) ?? '{}';
					const result = mergeSettings('{}', localJson, remoteJson);
					this._local.set(key, result.merged);
					hasConflicts = hasConflicts || result.hasConflicts;
					await this._remoteStore.set(key, result.merged);
				}
			}
		} catch {
			// Network failure: keep the local snapshot untouched.
		}
		this._setStatus(hasConflicts ? SyncStatus.HasConflicts : SyncStatus.Idle);
	}

	private _setStatus(status: SyncStatus): void {
		this._status = status;
		this._onDidChangeStatus.fire(status);
	}
}
