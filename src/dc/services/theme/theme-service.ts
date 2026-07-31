/**
 * Dardcor Code - Theme Service State Controller (Task 128)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { Color } from '../../core/math/color.js';
import { IColorRegistry, ColorThemeKind, getColorRegistry } from './color-registry.js';

export interface IThemeTokenColor {
	readonly scope: string | string[];
	readonly foreground?: string;
	readonly background?: string;
	readonly fontStyle?: string;
}

export interface IColorTheme {
	readonly id: string;
	readonly label: string;
	readonly kind: ColorThemeKind;
	readonly tokenColors: readonly IThemeTokenColor[];
	getColor(colorId: string): Color | undefined;
	isDark(): boolean;
	isHighContrast(): boolean;
}

export interface IThemeService {
	readonly _serviceBrand: undefined;
	readonly onDidColorThemeChange: Event<IColorTheme>;
	getColorTheme(): IColorTheme;
	setColorTheme(themeId: string): void;
	getThemes(): IColorTheme[];
}

export const IThemeService = createDecorator<IThemeService>('themeService');

export class ColorTheme implements IColorTheme {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly kind: ColorThemeKind,
		public readonly tokenColors: readonly IThemeTokenColor[] = [],
		private readonly _colorRegistry: IColorRegistry = getColorRegistry()
	) {}

	public getColor(colorId: string): Color | undefined {
		return this._colorRegistry.getColor(colorId, this.kind);
	}

	public isDark(): boolean {
		return this.kind === 'dark' || this.kind === 'hc';
	}

	public isHighContrast(): boolean {
		return this.kind === 'hc';
	}
}

export function buildDefaultThemes(colorRegistry: IColorRegistry = getColorRegistry()): ColorTheme[] {
	const darkModern: IThemeTokenColor[] = [
		{ scope: ['keyword', 'storage', 'control'], foreground: '#569cd6' },
		{ scope: 'string', foreground: '#ce9178' },
		{ scope: 'comment', foreground: '#6a9955' },
		{ scope: 'function', foreground: '#dcdcaa' },
		{ scope: 'number', foreground: '#b5cea8' },
		{ scope: 'type', foreground: '#4ec9b0' },
		{ scope: 'variable', foreground: '#9cdcfe' },
		{ scope: 'constant', foreground: '#569cd6' },
		{ scope: 'tag', foreground: '#569cd6' }
	];
	const lightModern: IThemeTokenColor[] = [
		{ scope: ['keyword', 'storage', 'control'], foreground: '#0000ff' },
		{ scope: 'string', foreground: '#a31515' },
		{ scope: 'comment', foreground: '#008000' },
		{ scope: 'function', foreground: '#795e26' },
		{ scope: 'number', foreground: '#098658' },
		{ scope: 'type', foreground: '#267f99' },
		{ scope: 'variable', foreground: '#001080' },
		{ scope: 'constant', foreground: '#0000ff' },
		{ scope: 'tag', foreground: '#800000' }
	];
	return [
		new ColorTheme('dark-modern', 'Dark Modern', 'dark', darkModern, colorRegistry),
		new ColorTheme('dark-plus', 'Dark+', 'dark', darkModern, colorRegistry),
		new ColorTheme('light-modern', 'Light Modern', 'light', lightModern, colorRegistry),
		new ColorTheme('light-plus', 'Light+', 'light', lightModern, colorRegistry),
		new ColorTheme('high-contrast', 'High Contrast', 'hc', [
			{ scope: ['keyword', 'string'], foreground: '#ffffff' },
			{ scope: 'comment', foreground: '#00ff00' }
		], colorRegistry)
	];
}

export class ThemeService extends Disposable implements IThemeService {
	declare readonly _serviceBrand: undefined;

	private readonly _themes: ColorTheme[];
	private _currentTheme: ColorTheme;

	private readonly _onDidColorThemeChange = this._register(new Emitter<IColorTheme>());
	readonly onDidColorThemeChange = this._onDidColorThemeChange.event;

	constructor(private readonly _colorRegistry: IColorRegistry = getColorRegistry()) {
		super();
		this._themes = buildDefaultThemes(this._colorRegistry);
		this._currentTheme = this._themes[0];
	}

	public getColorTheme(): IColorTheme {
		return this._currentTheme;
	}

	public setColorTheme(themeId: string): void {
		const theme = this._themes.find((t) => t.id === themeId);
		if (!theme || theme.id === this._currentTheme.id) {
			return;
		}
		this._currentTheme = theme;
		this._onDidColorThemeChange.fire(theme);
	}

	public getThemes(): IColorTheme[] {
		return [...this._themes];
	}
}
