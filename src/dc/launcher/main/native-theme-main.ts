import { BrowserWindow, nativeTheme, app } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export type SystemTheme = 'dark' | 'light';

export const DARK_TITLEBAR_OVERLAY: Electron.TitleBarOverlay = {
	color: '#323233',
	symbolColor: '#cccccc',
	height: 30
};

export const LIGHT_TITLEBAR_OVERLAY: Electron.TitleBarOverlay = {
	color: '#f3f3f3',
	symbolColor: '#1f1f1f',
	height: 30
};

export const DARK_BACKGROUND = '#1e1e1e';
export const LIGHT_BACKGROUND = '#ffffff';

export function getSystemTheme(): SystemTheme {
	return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

export function shouldUseDarkColors(): boolean {
	return nativeTheme.shouldUseDarkColors;
}

export function setThemeSource(source: 'system' | 'light' | 'dark'): void {
	nativeTheme.themeSource = source;
}

export function getThemeSource(): 'system' | 'light' | 'dark' {
	return nativeTheme.themeSource;
}

export function registerNativeThemeListener(cb: (theme: SystemTheme) => void): () => void {
	const handler = (): void => cb(getSystemTheme());
	nativeTheme.on('updated', handler);
	return () => {
		nativeTheme.removeListener('updated', handler);
	};
}

export function setWindowTheme(window: BrowserWindow, theme: SystemTheme): void {
	if (window.isDestroyed()) {
		return;
	}
	const overlay = theme === 'dark' ? DARK_TITLEBAR_OVERLAY : LIGHT_TITLEBAR_OVERLAY;
	window.setBackgroundColor(theme === 'dark' ? DARK_BACKGROUND : LIGHT_BACKGROUND);
	try {
		window.setTitleBarOverlay(overlay);
	} catch (err) {
		console.warn('[native-theme-main] setTitleBarOverlay failed:', err);
	}
}

export function applyThemeToAllWindows(theme: SystemTheme): void {
	for (const win of BrowserWindow.getAllWindows()) {
		setWindowTheme(win, theme);
	}
}

export class NativeThemeMain extends Disposable {
	private readonly _onDidChangeTheme = new Emitter<SystemTheme>();
	public readonly onDidChangeTheme = this._onDidChangeTheme.event;

	constructor() {
		super();
		this._register(this._onDidChangeTheme);
		this._register(toDisposable(() => {
			nativeTheme.removeListener('updated', this._handleUpdated);
		}));
		nativeTheme.on('updated', this._handleUpdated);
	}

	public get theme(): SystemTheme {
		return getSystemTheme();
	}

	public get dark(): boolean {
		return nativeTheme.shouldUseDarkColors;
	}

	public setSource(source: 'system' | 'light' | 'dark'): void {
		setThemeSource(source);
	}

	public applyTo(window: BrowserWindow): void {
		setWindowTheme(window, this.theme);
	}

	public applyToAll(): void {
		applyThemeToAllWindows(this.theme);
	}

	public watchWindow(window: BrowserWindow): void {
		this._register(this.onDidChangeTheme(() => setWindowTheme(window, this.theme)));
	}

	private readonly _handleUpdated = (): void => {
		const theme = this.theme;
		this._onDidChangeTheme.fire(theme);
	};
}

export function createNativeThemeMain(): NativeThemeMain {
	return new NativeThemeMain();
}

export function getAppName(): string {
	return app.getName();
}
