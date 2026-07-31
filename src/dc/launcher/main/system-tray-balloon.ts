import { Tray, Notification } from 'electron';

export interface BalloonResult {
	shown: boolean;
	method: 'balloon' | 'notification' | 'none';
}

export function showTrayBalloon(tray: Tray, title: string, content: string): BalloonResult {
	if (process.platform === 'win32') {
		try {
			tray.displayBalloon({ title, content });
			return { shown: true, method: 'balloon' };
		} catch (err) {
			console.warn('[system-tray-balloon] displayBalloon failed:', err);
		}
	}

	if (Notification.isSupported()) {
		try {
			const notification = new Notification({ title, body: content });
			notification.show();
			return { shown: true, method: 'notification' };
		} catch (err) {
			console.warn('[system-tray-balloon] notification fallback failed:', err);
		}
	}

	return { shown: false, method: 'none' };
}

export function showTrayBalloonWithIcon(tray: Tray, title: string, content: string, iconPath?: string): BalloonResult {
	if (process.platform === 'win32') {
		try {
			tray.displayBalloon({
				title,
				content,
				iconType: 'info'
			});
			return { shown: true, method: 'balloon' };
		} catch {
			// Fall through.
		}
	}
	if (Notification.isSupported()) {
		try {
			const options: Electron.NotificationConstructorOptions = { title, body: content };
			if (iconPath) {
				options.icon = iconPath;
			}
			const notification = new Notification(options);
			notification.show();
			return { shown: true, method: 'notification' };
		} catch {
			// Fall through.
		}
	}
	return { shown: false, method: 'none' };
}

export function showNotification(title: string, content: string): boolean {
	if (!Notification.isSupported()) {
		return false;
	}
	try {
		const notification = new Notification({ title, body: content });
		notification.show();
		return true;
	} catch (err) {
		console.warn('[system-tray-balloon] notification failed:', err);
		return false;
	}
}

export function isBalloonSupported(): boolean {
	return process.platform === 'win32';
}

export function isNotificationSupported(): boolean {
	return Notification.isSupported();
}
