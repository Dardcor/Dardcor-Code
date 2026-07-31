import { app, nativeImage } from 'electron';
import * as path from 'path';

export function isDockAvailable(): boolean {
	return process.platform === 'darwin' && !!app.dock;
}

export function setDockBadge(text: string): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	try {
		app.dock!.setBadge(text);
		return true;
	} catch (err) {
		console.error('[native-dock] setDockBadge failed:', err);
		return false;
	}
}

export function clearDockBadge(): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	try {
		app.dock!.setBadge('');
		return true;
	} catch (err) {
		console.error('[native-dock] clearDockBadge failed:', err);
		return false;
	}
}

export function setDockIcon(iconPath: string): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	try {
		const icon = nativeImage.createFromPath(iconPath);
		if (icon.isEmpty()) {
			return false;
		}
		app.dock!.setIcon(icon);
		return true;
	} catch (err) {
		console.error('[native-dock] setDockIcon failed:', err);
		return false;
	}
}

export function setDockIconFromDataUrl(dataUrl: string): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	try {
		const icon = nativeImage.createFromDataURL(dataUrl);
		if (icon.isEmpty()) {
			return false;
		}
		app.dock!.setIcon(icon);
		return true;
	} catch (err) {
		console.error('[native-dock] setDockIconFromDataUrl failed:', err);
		return false;
	}
}

export function setDockProgress(progress: number): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	try {
		app.dock!.setBadge(`${Math.round(progress * 100)}%`);
		return true;
	} catch {
		return false;
	}
}

export function showDock(): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	app.dock!.show();
	return true;
}

export function hideDock(): boolean {
	if (!isDockAvailable()) {
		return false;
	}
	app.dock!.hide();
	return true;
}

export function getDockDefaultIcon(): string {
	return path.join(app.getAppPath(), 'public', 'dardcor-code.png');
}

export function setDockIconFromImage(image: Electron.NativeImage): boolean {
	if (!isDockAvailable() || image.isEmpty()) {
		return false;
	}
	try {
		app.dock!.setIcon(image);
		return true;
	} catch {
		return false;
	}
}
