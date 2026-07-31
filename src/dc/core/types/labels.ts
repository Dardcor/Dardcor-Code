/**
 * Dardcor Code - OS File Path Label Formatter (Task 80)
 * Mirrors: vs/base/common/labels.ts
 */

declare const process: any;

export interface ILabelFormatOptions {
	os?: 'win32' | 'darwin' | 'linux';
	tildify?: boolean;
	relative?: boolean;
}

export function getPathLabel(resourcePath: string, options?: ILabelFormatOptions): string {
	const isWindows = (options?.os ?? detectOS()) === 'win32';
	let label = resourcePath;
	if (options?.tildify) {
		label = tildify(label, getHomeDir(), isWindows);
	}
	if (isWindows) {
		label = label.replace(/\//g, '\\');
	} else {
		label = label.replace(/\\/g, '/');
	}
	return label;
}

export function getBaseLabel(resourcePath: string): string {
	const segments = resourcePath.replace(/\\/g, '/').split('/');
	return segments[segments.length - 1] || resourcePath;
}

export function getDirLabel(resourcePath: string): string {
	const segments = resourcePath.replace(/\\/g, '/').split('/');
	segments.pop();
	return segments.join('/') || '/';
}

export function shortenPath(path: string, maxLength: number): string {
	if (path.length <= maxLength) return path;
	const sep = path.includes('\\') ? '\\' : '/';
	const segments = path.split(sep);
	if (segments.length <= 2) return path;
	const first = segments[0];
	const last = segments[segments.length - 1];
	const prefix = first + sep + '…' + sep;
	if (prefix.length + last.length >= maxLength) {
		return '…' + sep + last;
	}
	let result = prefix + last;
	for (let i = segments.length - 2; i > 0; i--) {
		const candidate = prefix + segments.slice(i).join(sep);
		if (candidate.length <= maxLength) {
			result = candidate;
		} else {
			break;
		}
	}
	return result;
}

export function tildify(path: string, homeDir: string, isWindows: boolean): string {
	const normalizedPath = isWindows ? path.toLowerCase() : path;
	const normalizedHome = isWindows ? homeDir.toLowerCase() : homeDir;
	if (normalizedPath.startsWith(normalizedHome)) {
		return '~' + path.substring(homeDir.length);
	}
	return path;
}

export function untildify(path: string, homeDir: string): string {
	if (path.startsWith('~/') || path.startsWith('~\\')) {
		return homeDir + path.substring(1);
	}
	if (path === '~') return homeDir;
	return path;
}

function detectOS(): 'win32' | 'darwin' | 'linux' {
	if (typeof process !== 'undefined' && process.platform) {
		return process.platform as any;
	}
	if (typeof navigator !== 'undefined') {
		const ua = navigator.userAgent;
		if (ua.includes('Win')) return 'win32';
		if (ua.includes('Mac')) return 'darwin';
	}
	return 'linux';
}

function getHomeDir(): string {
	if (typeof process !== 'undefined') {
		return (process.env?.HOME || process.env?.USERPROFILE || '~');
	}
	return '~';
}

export function getWindowTitle(parts: { fileName?: string; folderName?: string; appName?: string; dirty?: boolean }): string {
	const segments: string[] = [];
	if (parts.dirty) segments.push('● ');
	if (parts.fileName) segments.push(parts.fileName);
	if (parts.folderName) {
		if (segments.length > 0) segments.push(' — ');
		segments.push(parts.folderName);
	}
	if (parts.appName) {
		if (segments.length > 0) segments.push(' — ');
		segments.push(parts.appName);
	}
	return segments.join('');
}
