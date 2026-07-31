import { BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type BlurMaterial = 'none' | 'under-window' | 'selection' | 'header' | 'menu' | 'popover' | 'sidebar' | 'tooltip' | 'content' | 'window';

export class WindowBlur {
	public setOpacity(window: BrowserWindow, opacity: number): void {
		if (window.isDestroyed()) {
			return;
		}
		const clamped = Math.max(0, Math.min(1, opacity));
		window.setOpacity(clamped);
	}

	public getOpacity(window: BrowserWindow): number {
		if (window.isDestroyed()) {
			return 1;
		}
		return window.getOpacity();
	}

	public setBlurEnabled(window: BrowserWindow, enabled: boolean): void {
		if (window.isDestroyed()) {
			return;
		}
		if (process.platform === 'darwin') {
			this.addWindowBlurEffect(window, enabled);
		} else if (process.platform === 'win32') {
			this.setWindowsAcrylic(window, enabled);
		} else if (process.platform === 'linux') {
			this.setLinuxBlur(window, enabled);
		}
	}

	public addWindowBlurEffect(window: BrowserWindow, enabled: boolean = true): void {
		if (process.platform !== 'darwin' || window.isDestroyed()) {
			return;
		}
		try {
			if (enabled) {
				window.setVibrancy('under-window');
			} else {
				window.setVibrancy(null);
			}
		} catch (err) {
			console.warn('[native-window-blur] setVibrancy failed:', err);
		}
	}

	public setVibrancy(window: BrowserWindow, material: BlurMaterial): void {
		if (process.platform !== 'darwin' || window.isDestroyed()) {
			return;
		}
		try {
			window.setVibrancy(material === 'none' ? null : material as any);
		} catch (err) {
			console.warn('[native-window-blur] setVibrancy failed:', err);
		}
	}

	public setWindowsAcrylic(window: BrowserWindow, enabled: boolean): void {
		if (process.platform !== 'win32' || window.isDestroyed()) {
			return;
		}
		try {
			window.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
		} catch (err) {
			console.warn('[native-window-blur] setBackgroundMaterial failed:', err);
		}
	}

	public setLinuxBlur(window: BrowserWindow, enabled: boolean): void {
		if (process.platform !== 'linux' || window.isDestroyed()) {
			return;
		}
		try {
			if (enabled) {
				window.setBackgroundMaterial('acrylic');
			} else {
				window.setBackgroundMaterial('none');
			}
		} catch {
			// Linux blur not supported on all compositors.
		}
	}

	public setShadow(window: BrowserWindow, enabled: boolean): void {
		if (window.isDestroyed()) {
			return;
		}
		try {
			window.setHasShadow(enabled);
		} catch {
			// Ignore.
		}
	}

	public setTransparent(window: BrowserWindow, transparent: boolean): void {
		if (window.isDestroyed()) {
			return;
		}
		window.setBackgroundColor(transparent ? '#00000000' : '#1e1e1e');
	}

	public makeWindowGlass(window: BrowserWindow, material: BlurMaterial = 'sidebar'): void {
		if (window.isDestroyed()) {
			return;
		}
		this.setVibrancy(window, material);
		this.setOpacity(window, 0.92);
		this.setShadow(window, true);
	}
}

export function createWindowBlur(): WindowBlur {
	return new WindowBlur();
}

export function applyBlurToAllWindows(material: BlurMaterial = 'under-window'): void {
	const blur = new WindowBlur();
	for (const win of BrowserWindow.getAllWindows()) {
		blur.setVibrancy(win, material);
	}
}

export function getBlurIconPath(): string {
	return path.join(__dirname, '..', '..', '..', '..', '..', 'public', 'dardcor-code.png');
}
