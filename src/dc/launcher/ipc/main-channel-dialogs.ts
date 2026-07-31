import { BrowserWindow, dialog, ipcMain } from 'electron';

export function registerDialogChannels(): void {
	ipcMain.handle('dialog:openFolder', async (event: any, options?: any) => {
		try {
			const win = BrowserWindow.fromWebContents(event?.sender);
			const result = await dialog.showOpenDialog(win ?? undefined as any, {
				title: options?.title,
				defaultPath: options?.defaultPath,
				properties: ['openDirectory', ...(options?.multiSelections ? ['multiSelections'] : [])]
			} as any);
			if (result.canceled || result.filePaths.length === 0) {
				return null;
			}
			return options?.multiSelections ? result.filePaths : result.filePaths[0];
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('dialog:openFile', async (event: any, options?: any) => {
		try {
			const win = BrowserWindow.fromWebContents(event?.sender);
			const result = await dialog.showOpenDialog(win ?? undefined as any, {
				title: options?.title,
				defaultPath: options?.defaultPath,
				filters: options?.filters ?? [{ name: 'All Files', extensions: ['*'] }],
				properties: ['openFile', ...(options?.multiSelections ? ['multiSelections'] : [])]
			} as any);
			if (result.canceled || result.filePaths.length === 0) {
				return null;
			}
			return options?.multiSelections ? result.filePaths : result.filePaths[0];
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('dialog:saveFile', async (event: any, options?: any) => {
		try {
			const win = BrowserWindow.fromWebContents(event?.sender);
			const result = await dialog.showSaveDialog(win ?? undefined as any, {
				title: options?.title,
				defaultPath: options?.defaultPath,
				filters: options?.filters ?? [{ name: 'All Files', extensions: ['*'] }]
			} as any);
			if (result.canceled || !result.filePath) {
				return null;
			}
			return result.filePath;
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('dialog:showMessage', async (event: any, options?: any) => {
		try {
			const win = BrowserWindow.fromWebContents(event?.sender);
			const result = await dialog.showMessageBox(win ?? undefined as any, {
				type: options?.type ?? 'info',
				title: options?.title ?? 'Dardcor Code',
				message: options?.message ?? '',
				detail: options?.detail,
				buttons: options?.buttons ?? ['OK'],
				noLink: options?.noLink ?? true
			} as any);
			return { response: result.response, checked: result.checkboxChecked };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('dialog:showError', async (_event: any, title?: string, content?: string) => {
		try {
			dialog.showErrorBox(title ?? 'Dardcor Code', content ?? '');
			return { success: true };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});

	ipcMain.handle('dialog:showWarning', async (event: any, options?: any) => {
		try {
			const win = BrowserWindow.fromWebContents(event?.sender);
			const result = await dialog.showMessageBox(win ?? undefined as any, {
				type: 'warning',
				title: options?.title ?? 'Dardcor Code',
				message: options?.message ?? '',
				detail: options?.detail,
				buttons: options?.buttons ?? ['OK']
			} as any);
			return { response: result.response };
		} catch (err: any) {
			return { error: err?.message ?? String(err) };
		}
	});
}
