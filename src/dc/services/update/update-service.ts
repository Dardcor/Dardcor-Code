/**
 * Dardcor Code - Update Service (Task 147)
 * Mirrors: vs/platform/update/common/update.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export const enum StateType {
	Uninitialized = 'uninitialized',
	Idle = 'idle',
	CheckingForUpdates = 'checking for updates',
	AvailableForDownload = 'available for download',
	Downloading = 'downloading',
	Downloaded = 'downloaded',
	Updating = 'updating',
	Ready = 'ready',
}

export interface IUpdateState {
	type: StateType;
	version?: string;
}

export const IUpdateService = Symbol('IUpdateService');

export interface IUpdateService extends IDisposable {
	readonly onStateChange: Event<IUpdateState>;
	readonly state: IUpdateState;
	checkForUpdates(context: any): Promise<void>;
	downloadUpdate(): Promise<void>;
	applyUpdate(): Promise<void>;
	quitAndInstall(): Promise<void>;
}

export class UpdateService implements IUpdateService {
	private _state: IUpdateState = { type: StateType.Idle };
	private readonly _onStateChange = new Emitter<IUpdateState>();
	readonly onStateChange: Event<IUpdateState> = this._onStateChange.event;

	get state(): IUpdateState { return this._state; }

	private _setState(state: IUpdateState): void {
		this._state = state;
		this._onStateChange.fire(state);
	}

	async checkForUpdates(): Promise<void> {
		this._setState({ type: StateType.CheckingForUpdates });
		// No updates available in local native build
		this._setState({ type: StateType.Idle });
	}

	async downloadUpdate(): Promise<void> {}
	async applyUpdate(): Promise<void> {}
	async quitAndInstall(): Promise<void> {}

	dispose(): void {
		this._onStateChange.dispose();
	}
}
