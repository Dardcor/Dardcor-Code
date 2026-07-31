import { Emitter, Event } from 'dc/core/common/event';

export interface IServerTitlebarProperties {
	title: string;
	subtitle?: string;
	isMaximized: boolean;
	isFullscreen: boolean;
	isFocused: boolean;
	menuBarVisibility: 'classic' | 'toggle' | 'hidden' | 'compact' | 'default';
}

export interface IServerTitlebarService {
	readonly onDidChange: Event<Partial<IServerTitlebarProperties>>;
	getProperties(): IServerTitlebarProperties;
	updateTitle(title: string): void;
	updateSubtitle(subtitle: string): void;
	setMenuBarVisibility(visibility: IServerTitlebarProperties['menuBarVisibility']): void;
}

export class ServerTitlebarCommon implements IServerTitlebarService {
	private _properties: IServerTitlebarProperties = {
		title: 'Dardcor Code',
		subtitle: undefined,
		isMaximized: false,
		isFullscreen: false,
		isFocused: true,
		menuBarVisibility: 'default'
	};

	private readonly _onDidChange = new Emitter<Partial<IServerTitlebarProperties>>();
	readonly onDidChange: Event<Partial<IServerTitlebarProperties>> = this._onDidChange.event;

	getProperties(): IServerTitlebarProperties {
		return { ...this._properties };
	}

	updateTitle(title: string): void {
		this._properties.title = title;
		this._onDidChange.fire({ title });
	}

	updateSubtitle(subtitle: string): void {
		this._properties.subtitle = subtitle;
		this._onDidChange.fire({ subtitle });
	}

	setMenuBarVisibility(visibility: IServerTitlebarProperties['menuBarVisibility']): void {
		this._properties.menuBarVisibility = visibility;
		this._onDidChange.fire({ menuBarVisibility: visibility });
	}
}
