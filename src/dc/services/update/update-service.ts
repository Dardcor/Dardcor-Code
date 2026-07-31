/**
 * Dardcor Code - Update Service (Task 147)
 * Mirrors: vs/platform/update/common/update.ts (app auto-update background worker)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { UpdateChecker, IUpdateManifest } from './update-checker';
import { IRequestService } from '../request/request-service';

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

export const IUpdateService = createDecorator<IUpdateService>('updateService');

export interface IUpdateService {
	readonly _serviceBrand: undefined;
	readonly onStateChange: Event<IUpdateState>;
	readonly state: IUpdateState;
	checkForUpdates(context?: any): Promise<void>;
	downloadUpdate(): Promise<void>;
	applyUpdate(): Promise<void>;
	quitAndInstall(): Promise<void>;
}

export class UpdateService extends Disposable implements IUpdateService {
	declare readonly _serviceBrand: undefined;

	private _state: IUpdateState = { type: StateType.Idle };
	private _manifest: IUpdateManifest | null = null;

	private readonly _onStateChange = this._register(new Emitter<IUpdateState>());
	readonly onStateChange: Event<IUpdateState> = this._onStateChange.event;

	constructor(
		private readonly _requestService?: IRequestService,
		private readonly _updateServerUrl?: string,
		private readonly _currentVersion = '0.0.0'
	) {
		super();
	}

	get state(): IUpdateState {
		return this._state;
	}

	private _setState(state: IUpdateState): void {
		this._state = state;
		this._onStateChange.fire(state);
	}

	async checkForUpdates(_context?: any): Promise<void> {
		this._setState({ type: StateType.CheckingForUpdates });
		if (this._requestService && this._updateServerUrl) {
			try {
				const checker = new UpdateChecker(this._updateServerUrl, this._requestService);
				this._manifest = await checker.check(this._currentVersion);
			} catch {
				this._manifest = null;
			}
			if (this._manifest) {
				this._setState({ type: StateType.AvailableForDownload, version: this._manifest.version });
				return;
			}
		}
		this._manifest = null;
		this._setState({ type: StateType.Idle });
	}

	async downloadUpdate(): Promise<void> {
		if (this._state.type !== StateType.AvailableForDownload) {
			return;
		}
		this._setState({ type: StateType.Downloading, version: this._state.version });
		this._setState({ type: StateType.Downloaded, version: this._state.version });
	}

	async applyUpdate(): Promise<void> {
		if (this._state.type !== StateType.Downloaded) {
			return;
		}
		this._setState({ type: StateType.Updating, version: this._state.version });
	}

	async quitAndInstall(): Promise<void> {
		if (this._state.type === StateType.Updating || this._state.type === StateType.Downloaded) {
			this._setState({ type: StateType.Ready, version: this._state.version });
		}
	}
}
