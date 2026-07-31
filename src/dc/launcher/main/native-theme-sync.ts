import { BrowserWindow, nativeTheme } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import {
	DARK_BACKGROUND,
	DARK_TITLEBAR_OVERLAY,
	LIGHT_BACKGROUND,
	LIGHT_TITLEBAR_OVERLAY,
	SystemTheme,
	getSystemTheme
} from './native-theme-main';

export function syncWindowTheme(window: BrowserWindow): void {
	if (window.isDestroyed()) {
		return;
	}
	const dark = nativeTheme.shouldUseDarkColors;
	window.setBackgroundColor(dark ? DARK_BACKGROUND : LIGHT_BACKGROUND);
	try {
		window.setTitleBarOverlay(dark ? DARK_TITLEBAR_OVERLAY : LIGHT_TITLEBAR_OVERLAY);
	} catch (err) {
		console.warn('[native-theme-sync] setTitleBarOverlay failed:', err);
	}
	try {
		const nativeThemeValue = dark ? 'dark' : 'light';
		window.webContents.send('theme:changed', nativeThemeValue);
	} catch {
		// WebContents not ready yet.
	}
}

export function syncThemeForWebContents(webContents: Electron.WebContents): void {
	try {
		webContents.send('theme:changed', getSystemTheme());
	} catch {
		// Ignore.
	}
}

export function registerAutoSync(): () => void {
	const handler = (): void => {
		for (const win of BrowserWindow.getAllWindows()) {
			syncWindowTheme(win);
		}
	};
	nativeTheme.on('updated', handler);
	return () => {
		nativeTheme.removeListener('updated', handler);
	};
}

export function registerWindowAutoSync(window: BrowserWindow): () => void {
	const handler = (): void => syncWindowTheme(window);
	nativeTheme.on('updated', handler);
	window.once('closed', () => {
		nativeTheme.removeListener('updated', handler);
	});
	return () => {
		nativeTheme.removeListener('updated', handler);
	};
}

export class ThemeSync extends Disposable {
	constructor() {
		super();
		this._register(toDisposable(registerAutoSync()));
	}

	public sync(window: BrowserWindow): void {
		syncWindowTheme(window);
	}

	public syncAll(): void {
		for (const win of BrowserWindow.getAllWindows()) {
			syncWindowTheme(win);
		}
	}

	public getTheme(): SystemTheme {
		return getSystemTheme();
	}
}

export function createThemeSync(): ThemeSync {
	return new ThemeSync();
}

export function applyThemeColors(window: BrowserWindow, dark: boolean): void {
	window.setBackgroundColor(dark ? DARK_BACKGROUND : LIGHT_BACKGROUND);
	try {
		window.setTitleBarOverlay(dark ? DARK_TITLEBAR_OVERLAY : LIGHT_TITLEBAR_OVERLAY);
	} catch {
		// Ignore.
	}
}
