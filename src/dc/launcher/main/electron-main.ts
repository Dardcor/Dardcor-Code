/**
 * Dardcor Code - Native Electron Desktop Main Process
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';

declare const process: any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../');

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
	const iconPath = path.join(projectRoot, 'public', 'dardcor-code.png');

	mainWindow = new BrowserWindow({
		width: 1280,
		height: 800,
		title: 'Dardcor Code',
		icon: iconPath,
		autoHideMenuBar: false,
		backgroundColor: '#1e1e1e',
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});

	mainWindow.loadFile(path.join(projectRoot, 'index.html'));

	mainWindow.on('closed', () => {
		mainWindow = null;
	});
}

// Register Native IPC Handlers
ipcMain.handle('fs:readDir', async (_event: any, dirPath: string) => {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		return entries.map((e: any) => ({
			name: e.name,
			isDirectory: e.isDirectory(),
			isFile: e.isFile(),
			path: path.join(dirPath, e.name)
		}));
	} catch (err: any) {
		return { error: err.message };
	}
});

ipcMain.handle('fs:readFile', async (_event: any, filePath: string) => {
	try {
		const content = await fs.readFile(filePath, 'utf-8');
		return { content };
	} catch (err: any) {
		return { error: err.message };
	}
});

ipcMain.handle('fs:writeFile', async (_event: any, filePath: string, content: string) => {
	try {
		await fs.writeFile(filePath, content, 'utf-8');
		return { success: true };
	} catch (err: any) {
		return { error: err.message };
	}
});

ipcMain.handle('dialog:openFolder', async () => {
	if (!mainWindow) return null;
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ['openDirectory']
	});
	if (result.canceled || result.filePaths.length === 0) {
		return null;
	}
	return result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
	if (!mainWindow) return null;
	const result = await dialog.showOpenDialog(mainWindow, {
		properties: ['openFile']
	});
	if (result.canceled || result.filePaths.length === 0) {
		return null;
	}
	return result.filePaths[0];
});

app.whenReady().then(() => {
	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit();
	}
});
