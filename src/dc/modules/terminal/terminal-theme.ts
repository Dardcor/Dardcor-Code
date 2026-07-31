/**
 * Dardcor Code - Terminal Theme Management (Built-in & Custom)
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ITerminalThemeColors {
	readonly background: string;
	readonly foreground: string;
	readonly cursor: string;
	readonly cursorAccent: string;
	readonly selectionBackground: string;
	readonly black: string;
	readonly red: string;
	readonly green: string;
	readonly yellow: string;
	readonly blue: string;
	readonly magenta: string;
	readonly cyan: string;
	readonly white: string;
	readonly brightBlack: string;
	readonly brightRed: string;
	readonly brightGreen: string;
	readonly brightYellow: string;
	readonly brightBlue: string;
	readonly brightMagenta: string;
	readonly brightCyan: string;
	readonly brightWhite: string;
}

export interface ITerminalTheme {
	readonly id: string;
	readonly name: string;
	readonly colors: ITerminalThemeColors;
}

export class TerminalTheme extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _themes = new Map<string, ITerminalTheme>();
	private _activeId: string;

	constructor() {
		super();
		for (const theme of TerminalTheme.builtInThemes()) {
			this._themes.set(theme.id, theme);
		}
		this._activeId = 'dark';
	}

	get themes(): ITerminalTheme[] {
		return [...this._themes.values()];
	}

	get activeTheme(): ITerminalTheme {
		return this._themes.get(this._activeId) ?? this._themes.get('dark')!;
	}

	get activeId(): string {
		return this._activeId;
	}

	public setActive(id: string): void {
		if (this._themes.has(id) && id !== this._activeId) {
			this._activeId = id;
			this._onDidChange.fire();
		}
	}

	public registerTheme(theme: ITerminalTheme): void {
		this._themes.set(theme.id, theme);
		this._onDidChange.fire();
	}

	public getTheme(id: string): ITerminalTheme | undefined {
		return this._themes.get(id);
	}

	public toXtermOptions(theme?: ITerminalTheme): Record<string, string> {
		const colors = (theme ?? this.activeTheme).colors;
		return {
			foreground: colors.foreground,
			background: colors.background,
			cursor: colors.cursor,
			cursorAccent: colors.cursorAccent,
			selectionBackground: colors.selectionBackground,
			black: colors.black,
			red: colors.red,
			green: colors.green,
			yellow: colors.yellow,
			blue: colors.blue,
			magenta: colors.magenta,
			cyan: colors.cyan,
			white: colors.white,
			brightBlack: colors.brightBlack,
			brightRed: colors.brightRed,
			brightGreen: colors.brightGreen,
			brightYellow: colors.brightYellow,
			brightBlue: colors.brightBlue,
			brightMagenta: colors.brightMagenta,
			brightCyan: colors.brightCyan,
			brightWhite: colors.brightWhite
		};
	}

	public static builtInThemes(): ITerminalTheme[] {
		return [
			{
				id: 'dark',
				name: 'Dark (default)',
				colors: {
					background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', cursorAccent: '#1e1e1e',
					selectionBackground: '#264f78',
					black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
					blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
					brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b',
					brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6',
					brightCyan: '#29b8db', brightWhite: '#e5e5e5'
				}
			},
			{
				id: 'light',
				name: 'Light',
				colors: {
					background: '#ffffff', foreground: '#333333', cursor: '#000000', cursorAccent: '#ffffff',
					selectionBackground: '#add6ff',
					black: '#000000', red: '#cd3131', green: '#107c10', yellow: '#949800',
					blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
					brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14',
					brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc',
					brightCyan: '#0598bc', brightWhite: '#a5a5a5'
				}
			},
			{
				id: 'hacker',
				name: 'Hacker Green',
				colors: {
					background: '#001100', foreground: '#00ff41', cursor: '#00ff41', cursorAccent: '#001100',
					selectionBackground: '#005f00',
					black: '#000000', red: '#ff4444', green: '#00ff41', yellow: '#ffff00',
					blue: '#00aaff', magenta: '#ff00ff', cyan: '#00ffff', white: '#eeeeee',
					brightBlack: '#555555', brightRed: '#ff6666', brightGreen: '#55ff77',
					brightYellow: '#ffff55', brightBlue: '#55ccff', brightMagenta: '#ff55ff',
					brightCyan: '#55ffff', brightWhite: '#ffffff'
				}
			},
			{
				id: 'solarized',
				name: 'Solarized Dark',
				colors: {
					background: '#002b36', foreground: '#839496', cursor: '#93a1a1', cursorAccent: '#002b36',
					selectionBackground: '#073642',
					black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
					blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
					brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#859900',
					brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#d33682',
					brightCyan: '#2aa198', brightWhite: '#fdf6e3'
				}
			}
		];
	}
}
