import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export type ServerSyncStatus = 'uninitialized' | 'idle' | 'syncing' | 'hasConflicts';
export type ServerSyncResource = 'settings' | 'keybindings' | 'snippets' | 'tasks' | 'extensions' | 'globalState' | 'profiles';

export interface IServerSyncConflict {
	readonly resource: ServerSyncResource;
	readonly local: string;
	readonly remote: string;
	readonly base?: string;
}

export interface IServerUserDataSyncService {
	readonly onDidChangeStatus: Event<ServerSyncStatus>;
	readonly onDidChangeConflicts: Event<IServerSyncConflict[]>;
	readonly onDidChangeLocal: Event<void>;
	readonly status: ServerSyncStatus;
	readonly conflicts: IServerSyncConflict[];
	sync(): Promise<void>;
	replace(resource: string): Promise<void>;
	accept(resource: ServerSyncResource, content: string): Promise<void>;
	reset(): Promise<void>;
	resetLocal(): Promise<void>;
	isResourceEnabled(resource: ServerSyncResource): boolean;
	setResourceEnablement(resource: ServerSyncResource, enabled: boolean): void;
}

export class ServerUserDataSyncCommon implements IServerUserDataSyncService {
	private _status: ServerSyncStatus = 'idle';
	private _conflicts: IServerSyncConflict[] = [];
	private readonly _enabledResources = new Set<ServerSyncResource>(['settings', 'keybindings', 'snippets', 'extensions', 'globalState']);

	private readonly _onDidChangeStatus = new Emitter<ServerSyncStatus>();
	readonly onDidChangeStatus = this._onDidChangeStatus.event;

	private readonly _onDidChangeConflicts = new Emitter<IServerSyncConflict[]>();
	readonly onDidChangeConflicts = this._onDidChangeConflicts.event;

	private readonly _onDidChangeLocal = new Emitter<void>();
	readonly onDidChangeLocal = this._onDidChangeLocal.event;

	get status(): ServerSyncStatus { return this._status; }
	get conflicts(): IServerSyncConflict[] { return [...this._conflicts]; }

	async sync(): Promise<void> {
		if (this._status === 'syncing') return;
		this._setStatus('syncing');
		// Mock sync process
		setTimeout(() => this._setStatus('idle'), 100);
	}

	async replace(_resource: string): Promise<void> {}

	async accept(resource: ServerSyncResource, _content: string): Promise<void> {
		const idx = this._conflicts.findIndex(c => c.resource === resource);
		if (idx >= 0) {
			this._conflicts.splice(idx, 1);
			this._onDidChangeConflicts.fire(this.conflicts);
			if (this._conflicts.length === 0) {
				this._setStatus('idle');
			}
		}
	}

	async reset(): Promise<void> {
		this._setStatus('uninitialized');
		this._conflicts = [];
		this._onDidChangeConflicts.fire(this.conflicts);
	}

	async resetLocal(): Promise<void> {}

	isResourceEnabled(resource: ServerSyncResource): boolean {
		return this._enabledResources.has(resource);
	}

	setResourceEnablement(resource: ServerSyncResource, enabled: boolean): void {
		if (enabled) {
			this._enabledResources.add(resource);
		} else {
			this._enabledResources.delete(resource);
		}
	}

	private _setStatus(status: ServerSyncStatus): void {
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(status);
		}
	}
}
