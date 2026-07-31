import { BrowserWindow, ipcMain } from 'electron';

function windowFor(event: any): BrowserWindow | null {
	if (!event?.sender) {
		return null;
	}
	return BrowserWindow.fromWebContents(event.sender);
}

export function registerWindowChannels(): void {
	ipcMain.handle('window:minimize', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			win.minimize();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:maximize', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			if (win.isMaximized()) {
				win.unmaximize();
			} else {
				win.maximize();
			}
			return { success: true, maximized: win.isMaximized() };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:unmaximize', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			win.unmaximize();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:isMaximized', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			return { maximized: win.isMaximized() };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:close', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			win.close();
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:fullscreen', (event: any, fullscreen?: boolean) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			const target = fullscreen ?? !win.isFullScreen();
			win.setFullScreen(target);
			return { success: true, fullscreen: target };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:setTitle', (event: any, title: string) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			win.setTitle(title ?? 'Dardcor Code');
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:setSize', (event: any, width: number, height: number) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			win.setSize(width, height);
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('window:getBounds', (event: any) => {
		const win = windowFor(event);
		if (!win) return { error: 'No window for sender' };
		try {
			const bounds = win.getBounds();
			return { bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});
}
