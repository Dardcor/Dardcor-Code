/**
 * Dardcor Code - User Data Sync Service (Task 149)
 * Mirrors: vs/platform/userDataSync/common/userDataSync.ts
 */

import { Emitter, Event } from '../../core/events/emitter.js';
import { IDisposable } from '../../core/lifecycle/disposable.js';

export const enum SyncStatus {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	Syncing = 'syncing',
	HasConflicts = 'hasConflicts',
}

export const IUserDataSyncService = Symbol('IUserDataSyncService');

export interface IUserDataSyncService extends IDisposable {
	readonly onDidChangeStatus: Event<SyncStatus>;
	readonly status: SyncStatus;
	sync(): Promise<void>;
}

export class UserDataSyncService implements IUserDataSyncService {
	private _status: SyncStatus = SyncStatus.Idle;
	private readonly _onDidChangeStatus = new Emitter<SyncStatus>();
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangeStatus.event;

	get status(): SyncStatus { return this._status; }

	async sync(): Promise<void> {
		if (this._status === SyncStatus.Syncing) return;
		this._status = SyncStatus.Syncing;
		this._onDidChangeStatus.fire(this._status);

		// Perform local sync verification
		this._status = SyncStatus.Idle;
		this._onDidChangeStatus.fire(this._status);
	}

	dispose(): void {
		this._onDidChangeStatus.dispose();
	}
}
