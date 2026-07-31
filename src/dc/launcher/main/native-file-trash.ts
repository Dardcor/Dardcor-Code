import { shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, execFile } from 'child_process';

export function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unitIndex = -1;
	do {
		value /= 1024;
		unitIndex++;
	} while (value >= 1024 && unitIndex < units.length - 1);
	return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function trashFile(filePath: string): Promise<boolean> {
	if (!filePath) {
		return false;
	}
	try {
		if (!fs.existsSync(filePath)) {
			return false;
		}
	} catch {
		return false;
	}

	try {
		await shell.trashItem(filePath);
		return true;
	} catch (err) {
		console.warn('[native-file-trash] shell.trashItem failed, falling back:', err);
	}

	if (process.platform === 'win32') {
		return trashOnWindows(filePath);
	}

	try {
		fs.rmSync(filePath, { recursive: true, force: true });
		return true;
	} catch (err) {
		console.error('[native-file-trash] delete fallback failed:', err);
		return false;
	}
}

export async function trashFiles(filePaths: string[]): Promise<number> {
	let success = 0;
	for (const filePath of filePaths) {
		if (await trashFile(filePath)) {
			success++;
		}
	}
	return success;
}

function trashOnWindows(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const script = [
			'$shell = New-Object -ComObject Shell.Application',
			`$item = $shell.Namespace((Split-Path -Parent '${escapePowerShell(filePath)}')).ParseName((Split-Path -Leaf '${escapePowerShell(filePath)}'))`,
			'$item.InvokeVerb("delete")',
			'Start-Sleep -Milliseconds 500'
		].join('; ');
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			stdio: 'ignore',
			windowsHide: true
		});
		child.on('error', () => resolve(false));
		child.on('close', (code) => {
			if (code === 0) {
				resolve(true);
				return;
			}
			try {
				fs.rmSync(filePath, { recursive: true, force: true });
				resolve(true);
			} catch {
				resolve(false);
			}
		});
	});
}

export function isTrashSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
}

export function moveToTrashFallback(filePath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const dir = path.dirname(filePath);
		const name = path.basename(filePath);
		execFile('mv', [filePath, `${process.env.HOME ?? ''}/.local/share/Trash/files/${name}`], (err) => {
			if (!err) {
				resolve(true);
				return;
			}
			try {
				fs.rmSync(filePath, { recursive: true, force: true });
				resolve(true);
			} catch {
				resolve(false);
			}
		});
	});
}

function escapePowerShell(value: string): string {
	return value.replace(/'/g, "''");
}

export async function isInTrash(filePath: string): Promise<boolean> {
	try {
		await fs.promises.access(filePath);
		return false;
	} catch {
		return true;
	}
}
