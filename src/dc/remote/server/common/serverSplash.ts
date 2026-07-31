import { Emitter, Event } from 'dc/core/common/event';

export interface IServerSplash {
	readonly id: string;
	readonly imageUri?: string;
	readonly backgroundColor?: string;
	readonly layoutInfo?: { layoutId: string; features: string[] };
}

export interface IServerSplashService {
	readonly onDidHideSplash: Event<void>;
	readonly onDidChangeSplash: Event<IServerSplash>;
	getSplash(): IServerSplash;
	setSplash(splash: IServerSplash): void;
	hideSplash(): void;
	isSplashVisible(): boolean;
}

export class ServerSplashCommon implements IServerSplashService {
	private _splash: IServerSplash = { id: 'default-splash' };
	private _isVisible = true;

	private readonly _onDidHideSplash = new Emitter<void>();
	readonly onDidHideSplash = this._onDidHideSplash.event;

	private readonly _onDidChangeSplash = new Emitter<IServerSplash>();
	readonly onDidChangeSplash = this._onDidChangeSplash.event;

	getSplash(): IServerSplash {
		return this._splash;
	}

	setSplash(splash: IServerSplash): void {
		this._splash = splash;
		this._onDidChangeSplash.fire(splash);
	}

	hideSplash(): void {
		if (this._isVisible) {
			this._isVisible = false;
			this._onDidHideSplash.fire();
		}
	}

	isSplashVisible(): boolean {
		return this._isVisible;
	}
}
