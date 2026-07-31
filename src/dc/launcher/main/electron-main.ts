/**
 * Dardcor Code - Native Electron Desktop Main Process
 * Provides: BrowserWindow, IPC for file system, dialogs, and terminal
 */

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';

declare const process: any;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../../../');

let mainWindow: BrowserWindow | null = null;

// Terminal process management
const terminals = new Map<number, ChildProcess>();
let nextTerminalId = 1;

function createWindow(): void {
	const iconPath = path.join(projectRoot, 'public', 'dardcor-code.png');

	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		title: 'Dardcor Code',
		icon: iconPath,
		autoHideMenuBar: true,
		backgroundColor: '#000000',
		titleBarStyle: 'hidden',
		titleBarOverlay: {
			color: '#000000',
			symbolColor: '#ffffff',
			height: 35
		},
		webPreferences: {
			nodeIntegration: true,
			contextIsolation: false
		}
	});

	mainWindow.loadFile(path.join(projectRoot, 'index.html'));

	mainWindow.on('closed', () => {
		// Kill all terminal processes
		for (const [id, proc] of terminals) {
			try { proc.kill(); } catch { /* ignore */ }
			terminals.delete(id);
		}
		mainWindow = null;
	});
}

// ─── File System IPC ─────────────────────────────────────────────

ipcMain.handle('fs:readDir', async (_event: any, dirPath: string) => {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		return entries
			.filter((e: any) => !e.name.startsWith('.'))
			.sort((a: any, b: any) => {
				// Directories first, then files
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			})
			.map((e: any) => ({
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

ipcMain.handle('fs:stat', async (_event: any, filePath: string) => {
	try {
		const stat = await fs.stat(filePath);
		return {
			isFile: stat.isFile(),
			isDirectory: stat.isDirectory(),
			size: stat.size,
			mtime: stat.mtime.getTime()
		};
	} catch (err: any) {
		return { error: err.message };
	}
});

// ─── Dialog IPC ──────────────────────────────────────────────────

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
		properties: ['openFile'],
		filters: [
			{ name: 'All Files', extensions: ['*'] },
			{ name: 'TypeScript', extensions: ['ts', 'tsx'] },
			{ name: 'JavaScript', extensions: ['js', 'jsx'] },
			{ name: 'JSON', extensions: ['json'] },
			{ name: 'HTML', extensions: ['html', 'htm'] },
			{ name: 'CSS', extensions: ['css', 'scss', 'less'] },
			{ name: 'Markdown', extensions: ['md'] }
		]
	});
	if (result.canceled || result.filePaths.length === 0) {
		return null;
	}
	return result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_event: any, defaultPath?: string) => {
	if (!mainWindow) return null;
	const result = await dialog.showSaveDialog(mainWindow, {
		defaultPath,
		filters: [{ name: 'All Files', extensions: ['*'] }]
	});
	if (result.canceled || !result.filePath) {
		return null;
	}
	return result.filePath;
});

// ─── Terminal IPC ────────────────────────────────────────────────

ipcMain.handle('terminal:create', (_event: any, cwd?: string) => {
	const id = nextTerminalId++;
	const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash';
	const args = process.platform === 'win32' ? ['-NoLogo'] : [];

	const child = spawn(shell, args, {
		cwd: cwd || projectRoot,
		env: { ...process.env, TERM: 'xterm-256color' },
		shell: false
	});

	terminals.set(id, child);

	child.stdout?.on('data', (data: Buffer) => {
		mainWindow?.webContents.send('terminal:data', { id, data: data.toString() });
	});

	child.stderr?.on('data', (data: Buffer) => {
		mainWindow?.webContents.send('terminal:data', { id, data: data.toString() });
	});

	child.on('exit', (code: number | null) => {
		mainWindow?.webContents.send('terminal:exit', { id, code });
		terminals.delete(id);
	});

	return { id };
});

ipcMain.on('terminal:write', (_event: any, payload: { id: number; data: string }) => {
	const child = terminals.get(payload.id);
	if (child?.stdin?.writable) {
		child.stdin.write(payload.data);
	}
});

ipcMain.handle('terminal:resize', (_event: any, payload: { id: number; cols: number; rows: number }) => {
	// child_process doesn't support resize natively without node-pty
	// This is a stub for future node-pty integration
	return true;
});

ipcMain.handle('terminal:kill', (_event: any, id: number) => {
	const child = terminals.get(id);
	if (child) {
		try { child.kill(); } catch { /* ignore */ }
		terminals.delete(id);
	}
	return true;
});

// ─── App info ────────────────────────────────────────────────────

ipcMain.handle('app:getPath', () => {
	return projectRoot;
});

// ─── App Lifecycle ───────────────────────────────────────────────

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
