import { app, ipcMain, nativeTheme } from 'electron';

declare const process: any;

export function registerAppChannels(): void {
	ipcMain.handle('app:getPath', (_event: any, name?: string) => {
		try {
			return { path: app.getPath((name ?? 'userData') as any) };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('app:getVersion', () => {
		try {
			return { version: app.getVersion() };
		} catch {
			return { version: '1.0.0' };
		}
	});

	ipcMain.handle('app:getPlatform', () => {
		return { platform: typeof process !== 'undefined' ? process.platform : 'unknown' };
	});

	ipcMain.handle('app:getArch', () => {
		return { arch: typeof process !== 'undefined' ? process.arch : 'unknown' };
	});

	ipcMain.handle('app:getLocale', () => {
		try {
			return { locale: app.getLocale() };
		} catch {
			return { locale: 'en' };
		}
	});

	ipcMain.handle('app:getSystemTheme', () => {
		try {
			return { theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light' };
		} catch {
			return { theme: 'dark' };
		}
	});

	ipcMain.handle('app:quit', () => {
		try {
			app.quit();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});
}
