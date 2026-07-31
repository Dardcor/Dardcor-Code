import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerBannerItem {
	readonly id: string;
	readonly message: string;
	readonly icon?: string;
	readonly actions?: { label: string; run: () => void }[];
}

export interface IServerBannerService {
	readonly onDidChangeBanner: Event<IServerBannerItem | undefined>;
	show(item: IServerBannerItem): IDisposable;
	hide(id: string): void;
	getActiveBanner(): IServerBannerItem | undefined;
}

export class ServerBannerCommon implements IServerBannerService {
	private _activeBanner: IServerBannerItem | undefined;

	private readonly _onDidChangeBanner = new Emitter<IServerBannerItem | undefined>();
	readonly onDidChangeBanner: Event<IServerBannerItem | undefined> = this._onDidChangeBanner.event;

	show(item: IServerBannerItem): IDisposable {
		this._activeBanner = item;
		this._onDidChangeBanner.fire(item);
		return { dispose: () => this.hide(item.id) };
	}

	hide(id: string): void {
		if (this._activeBanner?.id === id) {
			this._activeBanner = undefined;
			this._onDidChangeBanner.fire(undefined);
		}
	}

	getActiveBanner(): IServerBannerItem | undefined {
		return this._activeBanner;
	}
}
