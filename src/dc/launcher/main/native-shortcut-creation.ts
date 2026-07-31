import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface ShortcutOptions {
	executablePath: string;
	args?: string;
	name: string;
	iconPath?: string;
	workingDirectory?: string;
	description?: string;
}

export function isShortcutCreationSupported(): boolean {
	return process.platform === 'win32' || process.platform === 'darwin' || process.platform === 'linux';
}

export function getDesktopPath(): string {
	if (process.platform === 'win32') {
		const dir = process.env.USERPROFILE ?? os.homedir();
		return path.join(dir, 'Desktop');
	}
	if (process.platform === 'darwin') {
		return path.join(os.homedir(), 'Desktop');
	}
	const xdg = process.env.XDG_DESKTOP_DIR;
	if (xdg) {
		return xdg;
	}
	return path.join(os.homedir(), 'Desktop');
}

export function getStartMenuPath(): string {
	const dir = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
	return path.join(dir, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
}

export function createDesktopShortcut(options: ShortcutOptions): Promise<boolean> {
	if (!isShortcutCreationSupported()) {
		return Promise.resolve(false);
	}
	if (process.platform === 'win32') {
		return createWindowsShortcut(options, getDesktopPath());
	}
	if (process.platform === 'darwin') {
		return createMacShortcut(options);
	}
	return createLinuxShortcut(options);
}

export function createStartMenuShortcut(options: ShortcutOptions): Promise<boolean> {
	if (process.platform !== 'win32') {
		return Promise.resolve(false);
	}
	return createWindowsShortcut(options, getStartMenuPath());
}

function createWindowsShortcut(options: ShortcutOptions, targetDir: string): Promise<boolean> {
	return new Promise((resolve) => {
		const shortcutPath = path.join(targetDir, `${options.name}.lnk`).replace(/'/g, "''");
		const script = [
			'$ws = New-Object -ComObject WScript.Shell',
			`$sc = $ws.CreateShortcut('${shortcutPath}')`,
			`$sc.TargetPath = '${options.executablePath.replace(/'/g, "''")}'`,
			`$sc.Arguments = '${(options.args ?? '').replace(/'/g, "''")}'`,
			`$sc.WorkingDirectory = '${(options.workingDirectory ?? path.dirname(options.executablePath)).replace(/'/g, "''")}'`,
			`$sc.Description = '${(options.description ?? 'Dardcor Code').replace(/'/g, "''")}'`,
			...(options.iconPath ? [`$sc.IconLocation = '${options.iconPath.replace(/'/g, "''")}'`] : []),
			'$sc.Save()'
		].join('; ');
		const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
			stdio: 'ignore',
			windowsHide: true
		});
		child.on('error', () => resolve(false));
		child.on('close', (code) => resolve(code === 0));
	});
}

function createMacShortcut(options: ShortcutOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const appName = options.name.endsWith('.app') ? options.name : `${options.name}.app`;
		const appPath = path.join(getDesktopPath(), appName);
		const contents = path.join(appPath, 'Contents');
		const macosDir = path.join(contents, 'MacOS');
		const executableName = options.name.replace(/\s+/g, '');
		try {
			fs.mkdirSync(macosDir, { recursive: true });
			fs.writeFileSync(
				path.join(contents, 'Info.plist'),
				`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>${executableName}</string><key>CFBundleIdentifier</key><string>com.dardcor.${executableName}</string><key>CFBundleName</key><string>${options.name}</string></dict></plist>`,
				'utf-8'
			);
			const launcher = path.join(macosDir, executableName);
			fs.writeFileSync(
				launcher,
				`#!/bin/bash\nexec "${options.executablePath}" ${options.args ?? ''} "$@"\n`,
				{ mode: 0o755 }
			);
			resolve(true);
		} catch (err) {
			console.error('[native-shortcut-creation] mac shortcut failed:', err);
			resolve(false);
		}
	});
}

function createLinuxShortcut(options: ShortcutOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const desktopPath = path.join(getDesktopPath(), `${options.name}.desktop`);
		const content = [
			'[Desktop Entry]',
			'Type=Application',
			`Name=${options.name}`,
			`Exec=${options.executablePath} ${options.args ?? ''}`,
			...(options.iconPath ? [`Icon=${options.iconPath}`] : []),
			...(options.description ? [`Comment=${options.description}`] : []),
			'Terminal=false',
			'Categories=Development;IDE;'
		].join('\n');
		try {
			fs.writeFileSync(desktopPath, content, { mode: 0o755 });
			fs.chmodSync(desktopPath, 0o755);
			resolve(true);
		} catch (err) {
			console.error('[native-shortcut-creation] linux shortcut failed:', err);
			resolve(false);
		}
	});
}

export async function createShortcutIfMissing(options: ShortcutOptions): Promise<boolean> {
	const desktopPath = getDesktopPath();
	const name = process.platform === 'win32' ? `${options.name}.lnk` : process.platform === 'darwin' ? `${options.name}.app` : `${options.name}.desktop`;
	if (fs.existsSync(path.join(desktopPath, name))) {
		return true;
	}
	return createDesktopShortcut(options);
}
