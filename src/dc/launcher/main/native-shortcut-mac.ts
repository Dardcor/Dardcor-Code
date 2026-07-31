import { app, Menu, MenuItemConstructorOptions, nativeImage } from 'electron';
import * as path from 'path';

export function isMac(): boolean {
	return process.platform === 'darwin';
}

export function registerMacBundle(): boolean {
	if (!isMac()) {
		return false;
	}
	try {
		app.setName('Dardcor Code');
		const iconPath = path.join(app.getAppPath(), 'public', 'dardcor-code.png');
		try {
			const icon = nativeImage.createFromPath(iconPath);
			if (!icon.isEmpty()) {
				app.dock?.setIcon(icon);
			}
		} catch {
			// Icon is optional.
		}
		return true;
	} catch (err) {
		console.error('[native-shortcut-mac] registerMacBundle failed:', err);
		return false;
	}
}

export function installMacAppMenu(): void {
	if (!isMac()) {
		return;
	}
	const template: MenuItemConstructorOptions[] = [
		{
			label: app.name,
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		},
		{ role: 'fileMenu' },
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' }
	];
	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function registerMacDockBehavior(): void {
	if (!isMac() || !app.dock) {
		return;
	}
	app.dock.setMenu(Menu.buildFromTemplate([
		{ label: 'New File', click: () => console.log('New File') },
		{ label: 'Open Recent', role: 'recentDocuments' },
		{ type: 'separator' },
		{ role: 'quit' }
	]));
}

export function getMacBundleId(): string | null {
	return isMac() ? 'com.dardcor.code' : null;
}

export function setMacBadge(badgeText: string): boolean {
	if (!isMac() || !app.dock) {
		return false;
	}
	app.dock.setBadge(badgeText);
	return true;
}

export function setMacVisibility(visible: boolean): boolean {
	if (!isMac() || !app.dock) {
		return false;
	}
	if (visible) {
		app.dock.show();
	} else {
		app.dock.hide();
	}
	return true;
}

export function bounceDockIcon(type: 'critical' | 'informational' = 'informational'): number | null {
	if (!isMac() || !app.dock) {
		return null;
	}
	return app.dock.bounce(type);
}

export function isMacBundleRegistered(): boolean {
	return isMac();
}
