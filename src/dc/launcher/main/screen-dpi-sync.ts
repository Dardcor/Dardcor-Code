import { BrowserWindow, screen, Display } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export interface DpiInfo {
	scaleFactor: number;
	dpiX: number;
	dpiY: number;
	displayId: number;
}

export function getScaleFactorForWindow(window: BrowserWindow): number {
	if (window.isDestroyed()) {
		return 1;
	}
	const display = screen.getDisplayMatching(window.getBounds());
	return display.scaleFactor;
}

export function getDisplayScaleFactor(displayId?: number): number {
	const display = displayId !== undefined
		? screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
		: screen.getPrimaryDisplay();
	return display.scaleFactor;
}

export function getDpiInfoForWindow(window: BrowserWindow): DpiInfo {
	const display = window.isDestroyed() ? screen.getPrimaryDisplay() : screen.getDisplayMatching(window.getBounds());
	return {
		scaleFactor: display.scaleFactor,
		dpiX: Math.round(96 * display.scaleFactor),
		dpiY: Math.round(96 * display.scaleFactor),
		displayId: display.id
	};
}

export function setWindowScaleFactor(window: BrowserWindow, factor: number): void {
	if (window.isDestroyed()) {
		return;
	}
	try {
		window.webContents.setZoomFactor(Math.max(0.25, Math.min(5, factor)));
	} catch (err) {
		console.warn('[screen-dpi-sync] setZoomFactor failed:', err);
	}
}

export function syncWindowToDisplayDpi(window: BrowserWindow): void {
	const factor = getScaleFactorForWindow(window);
	const zoom = factor / getPrimaryScaleFactor();
	setWindowScaleFactor(window, zoom);
}

export function syncWindowToDpi(window: BrowserWindow, display: Display): void {
	const zoom = display.scaleFactor / getPrimaryScaleFactor();
	setWindowScaleFactor(window, zoom);
}

export function registerDpiSync(): () => void {
	const handler = (_event: Electron.Event, display: Display): void => {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				const winDisplay = screen.getDisplayMatching(win.getBounds());
				if (winDisplay.id === display.id) {
					syncWindowToDpi(win, display);
				}
			}
		}
	};
	screen.on('display-metrics-changed', handler);
	return () => {
		screen.removeListener('display-metrics-changed', handler);
	};
}

export class DpiSync extends Disposable {
	constructor() {
		super();
		this._register(toDisposable(registerDpiSync()));
	}

	public sync(window: BrowserWindow): void {
		syncWindowToDisplayDpi(window);
	}

	public syncAll(): void {
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				syncWindowToDisplayDpi(win);
			}
		}
	}

	public getInfo(window: BrowserWindow): DpiInfo {
		return getDpiInfoForWindow(window);
	}
}

export function createDpiSync(): DpiSync {
	return new DpiSync();
}

function getPrimaryScaleFactor(): number {
	return screen.getPrimaryDisplay().scaleFactor;
}

export function getDpiForDisplay(display: Display): { dpiX: number; dpiY: number } {
	return {
		dpiX: Math.round(96 * display.scaleFactor),
		dpiY: Math.round(96 * display.scaleFactor)
	};
}
