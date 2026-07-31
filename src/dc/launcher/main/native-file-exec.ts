import { BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

const EXECUTABLE_EXTENSIONS = new Set([
	'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'ps1', 'vbs', 'jar'
]);

export function isExecutableFile(filePath: string): boolean {
	const ext = path.extname(filePath).replace('.', '').toLowerCase();
	if (EXECUTABLE_EXTENSIONS.has(ext)) {
		return true;
	}
	if (process.platform === 'darwin' || process.platform === 'linux') {
		try {
			const stat = fs.statSync(filePath);
			return stat.isFile() && (stat.mode & 0o111) !== 0;
		} catch {
			return false;
		}
	}
	return false;
}

export async function confirmExecuteFile(window: BrowserWindow | null | undefined, filePath: string): Promise<boolean> {
	if (!isExecutableFile(filePath)) {
		return true;
	}
	const parent = window && !window.isDestroyed() ? window : undefined;
	const result = parent
		? await dialog.showMessageBox(parent, {
			type: 'warning',
			title: 'Security Warning',
			message: `Are you sure you want to run "${path.basename(filePath)}"?`,
			detail: [
				`File: ${filePath}`,
				'Running executable files can harm your computer.',
				'Only run files from sources you trust.'
			].join('\n'),
			buttons: ['Run', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
			noLink: true
		})
		: await dialog.showMessageBox({
			type: 'warning',
			title: 'Security Warning',
			message: `Are you sure you want to run "${path.basename(filePath)}"?`,
			detail: `File: ${filePath}\nRunning executable files can harm your computer. Only run files from sources you trust.`,
			buttons: ['Run', 'Cancel'],
			defaultId: 1,
			cancelId: 1,
			noLink: true
		});
	return result.response === 0;
}

export function openExecFile(filePath: string): Promise<boolean> {
	if (!fs.existsSync(filePath)) {
		return Promise.resolve(false);
	}
	return shell.openPath(filePath).then((err) => err === '');
}

export async function executeFileSafely(window: BrowserWindow | null | undefined, filePath: string): Promise<boolean> {
	const confirmed = await confirmExecuteFile(window, filePath);
	if (!confirmed) {
		return false;
	}
	return openExecFile(filePath);
}

export function runInTerminal(filePath: string, cwd?: string): boolean {
	const dir = cwd ?? path.dirname(filePath);
	try {
		if (process.platform === 'win32') {
			const child = spawn('powershell.exe', ['-NoLogo', '-Command', `& "${filePath}"`], {
				cwd: dir,
				detached: true,
				stdio: 'ignore',
				windowsHide: false
			});
			child.unref();
		} else {
			const child = spawn('sh', ['-c', `"${filePath}"`], {
				cwd: dir,
				detached: true,
				stdio: 'ignore'
			});
			child.unref();
		}
		return true;
	} catch (err) {
		console.error('[native-file-exec] failed to run in terminal:', err);
		return false;
	}
}

export function getExecutableExtensions(): string[] {
	return [...EXECUTABLE_EXTENSIONS];
}

export function getFileModeString(filePath: string): string | null {
	try {
		const stat = fs.statSync(filePath);
		const mode = stat.mode & 0o777;
		return mode.toString(8).padStart(3, '0');
	} catch {
		return null;
	}
}
