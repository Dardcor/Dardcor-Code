import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface LinuxProtocolResult {
	success: boolean;
	entryPath: string;
	error?: string;
}

export function isLinux(): boolean {
	return process.platform === 'linux';
}

export function getApplicationsDir(): string {
	return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.local', 'share', 'applications');
}

export function buildDesktopEntry(scheme: string, exec: string, name: string = 'Dardcor Code'): string {
	return [
		'[Desktop Entry]',
		'Type=Application',
		`Name=${name}`,
		`Exec=${exec} %u`,
		`MimeType=x-scheme-handler/${scheme};`,
		'Terminal=false',
		'Categories=Development;IDE;',
		'StartupNotify=false',
		'NoDisplay=true'
	].join('\n');
}

export function registerLinuxProtocol(
	scheme: string,
	desktopEntryName: string,
	exec: string,
	name: string = 'Dardcor Code'
): Promise<LinuxProtocolResult> {
	if (!isLinux()) {
		return Promise.resolve({ success: false, entryPath: '', error: 'Not Linux' });
	}
	return new Promise((resolve) => {
		const appsDir = getApplicationsDir();
		const entryPath = path.join(appsDir, `${desktopEntryName}.desktop`);
		try {
			fs.mkdirSync(appsDir, { recursive: true });
			const content = buildDesktopEntry(scheme, exec, name);
			fs.writeFileSync(entryPath, content, 'utf-8');
			fs.chmodSync(entryPath, 0o755);
			const child = spawn('update-desktop-database', [appsDir], {
				stdio: 'ignore'
			});
			child.on('error', () => {
				resolve({ success: true, entryPath });
			});
			child.on('close', () => {
				resolve({ success: true, entryPath });
			});
		} catch (err) {
			resolve({ success: false, entryPath, error: String(err) });
		}
	});
}

export function unregisterLinuxProtocol(desktopEntryName: string): Promise<LinuxProtocolResult> {
	if (!isLinux()) {
		return Promise.resolve({ success: false, entryPath: '', error: 'Not Linux' });
	}
	return new Promise((resolve) => {
		const entryPath = path.join(getApplicationsDir(), `${desktopEntryName}.desktop`);
		try {
			if (fs.existsSync(entryPath)) {
				fs.unlinkSync(entryPath);
			}
			resolve({ success: true, entryPath });
		} catch (err) {
			resolve({ success: false, entryPath, error: String(err) });
		}
	});
}

export function isLinuxProtocolRegistered(scheme: string, desktopEntryName: string): boolean {
	if (!isLinux()) {
		return false;
	}
	const entryPath = path.join(getApplicationsDir(), `${desktopEntryName}.desktop`);
	try {
		if (!fs.existsSync(entryPath)) {
			return false;
		}
		const content = fs.readFileSync(entryPath, 'utf-8');
		return content.includes(`x-scheme-handler/${scheme}`);
	} catch {
		return false;
	}
}

export function getRegisteredLinuxProtocols(desktopEntryName: string): string[] {
	if (!isLinux()) {
		return [];
	}
	const entryPath = path.join(getApplicationsDir(), `${desktopEntryName}.desktop`);
	try {
		if (!fs.existsSync(entryPath)) {
			return [];
		}
		const content = fs.readFileSync(entryPath, 'utf-8');
		const match = content.match(/MimeType=(.+)/);
		if (!match) {
			return [];
		}
		return match[1]
			.split(';')
			.filter((mime) => mime.startsWith('x-scheme-handler/'))
			.map((mime) => mime.replace('x-scheme-handler/', ''));
	} catch {
		return [];
	}
}

export function getDefaultDesktopEntryName(): string {
	return 'dardcor-code';
}
