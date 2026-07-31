import { app, autoUpdater } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';

export interface UpdateInfo {
	version?: string;
	releaseName?: string;
	releaseNotes?: string;
	releaseDate?: string;
}

export interface UpdateError {
	message: string;
	code?: number;
}

export interface AutoUpdaterOptions {
	simulate?: boolean;
	simulateDelayMs?: number;
}

export class AutoUpdater extends Disposable {
	private _state: UpdateState = 'idle';
	private _info: UpdateInfo | null = null;
	private _error: UpdateError | null = null;
	private _feedUrl: string | null = null;
	private readonly _options: AutoUpdaterOptions;
	private readonly _onStateChange = new Emitter<UpdateState>();
	public readonly onStateChange = this._onStateChange.event;
	private readonly _onUpdateAvailable = new Emitter<UpdateInfo>();
	public readonly onUpdateAvailable = this._onUpdateAvailable.event;
	private readonly _onUpdateDownloaded = new Emitter<UpdateInfo>();
	public readonly onUpdateDownloaded = this._onUpdateDownloaded.event;
	private readonly _onUpdateError = new Emitter<UpdateError>();
	public readonly onUpdateError = this._onUpdateError.event;
	private readonly _onProgress = new Emitter<{ percent: number; bytesPerSecond: number }>();
	public readonly onProgress = this._onProgress.event;

	constructor(options: AutoUpdaterOptions = {}) {
		super();
		this._options = options;
		this._register(this._onStateChange);
		this._register(this._onUpdateAvailable);
		this._register(this._onUpdateDownloaded);
		this._register(this._onUpdateError);
		this._register(this._onProgress);
		this._wire();
	}

	public get state(): UpdateState {
		return this._state;
	}

	public get info(): UpdateInfo | null {
		return this._info;
	}

	public get error(): UpdateError | null {
		return this._error;
	}

	public get feedUrl(): string | null {
		return this._feedUrl;
	}

	public setFeedURL(url: string): void {
		this._feedUrl = url;
		if (this._options.simulate) {
			return;
		}
		try {
			autoUpdater.setFeedURL({ url });
		} catch (err) {
			this._setError(err);
		}
	}

	public checkForUpdates(): void {
		this._setState('checking');
		if (this._options.simulate) {
			setTimeout(() => {
				this._simulateAvailable();
			}, this._options.simulateDelayMs ?? 1500);
			return;
		}
		try {
			autoUpdater.checkForUpdates();
		} catch (err) {
			this._setError(err);
		}
	}

	public downloadUpdate(): void {
		if (this._state !== 'available' && this._state !== 'checking') {
			return;
		}
		this._setState('downloading');
		if (this._options.simulate) {
			let percent = 0;
			const timer = setInterval(() => {
				percent += 10;
				this._onProgress.fire({ percent: Math.min(100, percent), bytesPerSecond: 0 });
				if (percent >= 100) {
					clearInterval(timer);
					this._simulateDownloaded();
				}
			}, 300);
			this._register(toDisposable(() => clearInterval(timer)));
			return;
		}
		try {
			(autoUpdater as any).downloadUpdate?.();
		} catch (err) {
			this._setError(err);
		}
	}

	public quitAndInstall(): void {
		if (this._options.simulate) {
			this._setState('idle');
			return;
		}
		try {
			autoUpdater.quitAndInstall();
		} catch (err) {
			this._setError(err);
		}
	}

	public getState(): UpdateState {
		return this._state;
	}

	public isUpdateAvailable(): boolean {
		return this._state === 'available' || this._state === 'downloaded';
	}

	public simulateAvailable(version: string = '99.0.0'): void {
		this._info = { version, releaseName: `Simulated ${version}`, releaseNotes: 'Simulated update' };
		this._setState('available');
		this._onUpdateAvailable.fire(this._info);
	}

	public override dispose(): void {
		super.dispose();
	}

	private _wire(): void {
		autoUpdater.on('checking-for-update', () => this._setState('checking'));
		autoUpdater.on('update-available', () => {
			const info: UpdateInfo = {};
			this._info = info;
			this._setState('available');
			this._onUpdateAvailable.fire(this._info);
		});
		autoUpdater.on('update-not-available', () => this._setState('not-available'));
		autoUpdater.on('update-downloaded', (_event: Electron.Event, releaseNotes: string, releaseName: string, releaseDate: Date, _updateURL: string, version: string) => {
			this._info = { version, releaseName, releaseNotes, releaseDate: releaseDate?.toISOString() };
			this._setState('downloaded');
			this._onUpdateDownloaded.fire(this._info);
		});
		autoUpdater.on('error', (err: Error) => this._setError(err));
	}

	private _simulateAvailable(): void {
		this.simulateAvailable();
	}

	private _simulateDownloaded(): void {
		this._setState('downloaded');
		this._onUpdateDownloaded.fire(this._info ?? {});
	}

	private _setState(state: UpdateState): void {
		this._state = state;
		this._onStateChange.fire(state);
	}

	private _setError(err: unknown): void {
		const error: UpdateError = {
			message: err instanceof Error ? err.message : String(err)
		};
		this._error = error;
		this._setState('error');
		this._onUpdateError.fire(error);
	}
}

export function createAutoUpdater(options?: AutoUpdaterOptions): AutoUpdater {
	return new AutoUpdater(options);
}
