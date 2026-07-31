/**
 * Dardcor Code - Theme Color Sync For Window Native Frame
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { isElectron } from '../../../core/environment/platform.js';

export interface ITitlebarThemeColors {
	readonly titlebarBackground: string;
	readonly titlebarForeground: string;
	readonly titlebarBorder: string;
	readonly activitybarBackground: string;
	readonly sidebarBackground: string;
	readonly editorBackground: string;
	readonly statusbarBackground: string;
	readonly tabActiveBackground: string;
	readonly tabInactiveBackground: string;
}

export const DEFAULT_TITLEBAR_COLORS: ITitlebarThemeColors = {
	titlebarBackground: '#323233',
	titlebarForeground: '#cccccc',
	titlebarBorder: '#2b2b2b',
	activitybarBackground: '#333333',
	sidebarBackground: '#252526',
	editorBackground: '#1e1e1e',
	statusbarBackground: '#007acc',
	tabActiveBackground: '#1e1e1e',
	tabInactiveBackground: '#2d2d2d',
};

const CSS_VARIABLES: Record<keyof ITitlebarThemeColors, string> = {
	titlebarBackground: '--dc-titlebar-bg',
	titlebarForeground: '--dc-titlebar-fg',
	titlebarBorder: '--dc-titlebar-border',
	activitybarBackground: '--dc-activitybar-bg',
	sidebarBackground: '--dc-sidebar-bg',
	editorBackground: '--dc-editor-bg',
	statusbarBackground: '--dc-statusbar-bg',
	tabActiveBackground: '--dc-tab-active-bg',
	tabInactiveBackground: '--dc-tab-inactive-bg',
};

export class CustomTitlebarTheme extends Disposable {
	private _colors: ITitlebarThemeColors = { ...DEFAULT_TITLEBAR_COLORS };
	private _nativeThemeListener: { dispose(): void } | null = null;
	private _applyNative = isElectron;

	private readonly _onDidChangeTheme = this._register(new Emitter<ITitlebarThemeColors>());
	readonly onDidChangeTheme: Event<ITitlebarThemeColors> = this._onDidChangeTheme.event;

	constructor() {
		super();
		this._applyVariables();
		this._setupNativeSync();
	}

	get colors(): ITitlebarThemeColors {
		return this._colors;
	}

	setColors(colors: Partial<ITitlebarThemeColors>): void {
		this._colors = { ...this._colors, ...colors };
		this._applyVariables();
		this._applyNativeBackground();
		this._onDidChangeTheme.fire(this._colors);
	}

	reset(): void {
		this._colors = { ...DEFAULT_TITLEBAR_COLORS };
		this._applyVariables();
		this._applyNativeBackground();
		this._onDidChangeTheme.fire(this._colors);
	}

	getCssVariable(name: keyof ITitlebarThemeColors): string {
		return getComputedStyle(document.documentElement).getPropertyValue(CSS_VARIABLES[name]).trim() || this._colors[name];
	}

	readColorsFromDom(): void {
		const titlebar = document.querySelector('.dc-part-titlebar') as HTMLElement | null;
		if (titlebar) {
			const style = getComputedStyle(titlebar);
			this.setColors({
				titlebarBackground: style.backgroundColor || this._colors.titlebarBackground,
				titlebarForeground: style.color || this._colors.titlebarForeground,
			});
		}
	}

	private _applyVariables(): void {
		const root = document.documentElement;
		for (const [key, variable] of Object.entries(CSS_VARIABLES) as [keyof ITitlebarThemeColors, string][]) {
			root.style.setProperty(variable, this._colors[key]);
		}
	}

	private _applyNativeBackground(): void {
		try {
			if (this._applyNative && typeof require !== 'undefined') {
				const electron = require('electron');
				const win = electron.remote?.getCurrentWindow?.() ?? electron.getCurrentWindow?.();
				if (win && typeof win.setBackgroundColor === 'function') {
					win.setBackgroundColor(this._colors.titlebarBackground);
				}
				if (typeof win?.setTitleBarOverlay === 'function') {
					win.setTitleBarOverlay({
						color: this._colors.titlebarBackground,
						symbolColor: this._colors.titlebarForeground,
						height: 32,
					});
				}
			}
		} catch {
			// native frame not available - web fallback keeps CSS variables
		}
	}

	private _setupNativeSync(): void {
		if (!this._applyNative) {
			return;
		}
		try {
			const electron = require('electron');
			const nativeTheme = electron.remote?.nativeTheme ?? electron.nativeTheme;
			if (nativeTheme && typeof nativeTheme.on === 'function') {
				this._nativeThemeListener = nativeTheme.on('updated', () => {
					this._applyNativeBackground();
				});
			}
		} catch {
			// ignore when running outside electron
		}
	}

	dispose(): void {
		this._nativeThemeListener?.dispose();
		this._nativeThemeListener = null;
		super.dispose();
	}
}

let _instance: CustomTitlebarTheme | null = null;

export function getCustomTitlebarTheme(): CustomTitlebarTheme {
	if (!_instance) {
		_instance = new CustomTitlebarTheme();
	}
	return _instance;
}
