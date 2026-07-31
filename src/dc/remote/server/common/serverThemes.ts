import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerColorTheme {
	readonly id: string;
	readonly label: string;
	readonly type: 'light' | 'dark' | 'hcLight' | 'hcDark';
	readonly extensionId?: string;
}

export interface IServerIconTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionId?: string;
}

export interface IServerProductIconTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionId?: string;
}

export interface IServerThemesService {
	readonly onDidColorThemeChange: Event<IServerColorTheme>;
	readonly onDidFileIconThemeChange: Event<IServerIconTheme>;
	readonly onDidProductIconThemeChange: Event<IServerProductIconTheme>;
	getColorTheme(): IServerColorTheme;
	setColorTheme(themeId: string): Promise<void>;
	getColorThemes(): IServerColorTheme[];
	getFileIconTheme(): IServerIconTheme;
	setFileIconTheme(themeId: string): Promise<void>;
	getFileIconThemes(): IServerIconTheme[];
	getProductIconTheme(): IServerProductIconTheme;
	setProductIconTheme(themeId: string): Promise<void>;
	getProductIconThemes(): IServerProductIconTheme[];
	registerColorTheme(theme: IServerColorTheme): IDisposable;
	registerFileIconTheme(theme: IServerIconTheme): IDisposable;
	registerProductIconTheme(theme: IServerProductIconTheme): IDisposable;
}

export class ServerThemesCommon implements IServerThemesService {
	private readonly _colorThemes = new Map<string, IServerColorTheme>();
	private readonly _iconThemes = new Map<string, IServerIconTheme>();
	private readonly _productIconThemes = new Map<string, IServerProductIconTheme>();
	private _activeColorTheme: IServerColorTheme = { id: 'dardcor-dark', label: 'Dardcor Dark', type: 'dark' };
	private _activeIconTheme: IServerIconTheme = { id: 'vs-seti', label: 'Seti' };
	private _activeProductIconTheme: IServerProductIconTheme = { id: 'Default', label: 'Default' };

	private readonly _onDidColorThemeChange = new Emitter<IServerColorTheme>();
	readonly onDidColorThemeChange: Event<IServerColorTheme> = this._onDidColorThemeChange.event;

	private readonly _onDidFileIconThemeChange = new Emitter<IServerIconTheme>();
	readonly onDidFileIconThemeChange: Event<IServerIconTheme> = this._onDidFileIconThemeChange.event;

	private readonly _onDidProductIconThemeChange = new Emitter<IServerProductIconTheme>();
	readonly onDidProductIconThemeChange: Event<IServerProductIconTheme> = this._onDidProductIconThemeChange.event;

	getColorTheme(): IServerColorTheme { return this._activeColorTheme; }
	async setColorTheme(themeId: string): Promise<void> {
		const theme = this._colorThemes.get(themeId);
		if (theme) { this._activeColorTheme = theme; this._onDidColorThemeChange.fire(theme); }
	}
	getColorThemes(): IServerColorTheme[] { return Array.from(this._colorThemes.values()); }

	getFileIconTheme(): IServerIconTheme { return this._activeIconTheme; }
	async setFileIconTheme(themeId: string): Promise<void> {
		const theme = this._iconThemes.get(themeId);
		if (theme) { this._activeIconTheme = theme; this._onDidFileIconThemeChange.fire(theme); }
	}
	getFileIconThemes(): IServerIconTheme[] { return Array.from(this._iconThemes.values()); }

	getProductIconTheme(): IServerProductIconTheme { return this._activeProductIconTheme; }
	async setProductIconTheme(themeId: string): Promise<void> {
		const theme = this._productIconThemes.get(themeId);
		if (theme) { this._activeProductIconTheme = theme; this._onDidProductIconThemeChange.fire(theme); }
	}
	getProductIconThemes(): IServerProductIconTheme[] { return Array.from(this._productIconThemes.values()); }

	registerColorTheme(theme: IServerColorTheme): IDisposable {
		this._colorThemes.set(theme.id, theme);
		return { dispose: () => { this._colorThemes.delete(theme.id); } };
	}
	registerFileIconTheme(theme: IServerIconTheme): IDisposable {
		this._iconThemes.set(theme.id, theme);
		return { dispose: () => { this._iconThemes.delete(theme.id); } };
	}
	registerProductIconTheme(theme: IServerProductIconTheme): IDisposable {
		this._productIconThemes.set(theme.id, theme);
		return { dispose: () => { this._productIconThemes.delete(theme.id); } };
	}
}
