import { BrowserWindow } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export class ScreenCapturePrevention extends Disposable {
	private readonly _windows = new Set<BrowserWindow>();

	public preventScreenCapture(window: BrowserWindow, enabled: boolean): void {
		if (window.isDestroyed()) {
			return;
		}
		try {
			window.setContentProtection(enabled);
			if (enabled) {
				this._windows.add(window);
			} else {
				this._windows.delete(window);
			}
		} catch (err) {
			console.warn('[screen-capture-prevention] setContentProtection failed:', err);
		}
	}

	public isScreenCapturePrevented(window: BrowserWindow): boolean {
		return this._windows.has(window);
	}

	public preventAll(): void {
		for (const win of BrowserWindow.getAllWindows()) {
			this.preventScreenCapture(win, true);
		}
	}

	public unprotectAll(): void {
		for (const win of BrowserWindow.getAllWindows()) {
			this.preventScreenCapture(win, false);
		}
		this._windows.clear();
	}

	public track(window: BrowserWindow): void {
		if (window.isDestroyed()) {
			return;
		}
		window.once('closed', () => {
			this._windows.delete(window);
		});
	}

	public getProtectedWindows(): BrowserWindow[] {
		return [...this._windows].filter((w) => !w.isDestroyed());
	}

	public isSupported(): boolean {
		return true;
	}

	public override dispose(): void {
		this.unprotectAll();
		super.dispose();
	}
}

export function createScreenCapturePrevention(): ScreenCapturePrevention {
	return new ScreenCapturePrevention();
}

export function preventScreenCapture(window: BrowserWindow, enabled: boolean): void {
	try {
		window.setContentProtection(enabled);
	} catch (err) {
		console.warn('[screen-capture-prevention] setContentProtection failed:', err);
	}
}

export function applyContentProtectionToAllWindows(enabled: boolean): void {
	for (const win of BrowserWindow.getAllWindows()) {
		preventScreenCapture(win, enabled);
	}
}

export function isContentProtectionSupported(): boolean {
	return true;
}
