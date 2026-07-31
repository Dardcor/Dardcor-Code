import { stat as statFs, chmod as chmodFs, chown as chownFs } from 'node:fs/promises';
import type { Stats } from 'node:fs';

export interface IPermissionInfo {
	readonly mode: number;
	readonly readable: string;
	readonly writable: boolean;
	readonly executable: boolean;
	readonly ownerRead: boolean;
	readonly ownerWrite: boolean;
	readonly ownerExec: boolean;
	readonly groupRead: boolean;
	readonly groupWrite: boolean;
	readonly groupExec: boolean;
	readonly otherRead: boolean;
	readonly otherWrite: boolean;
	readonly otherExec: boolean;
}

const MODE_CHARS = [
	['r', 'w', 'x'],
	['r', 'w', 'x'],
	['r', 'w', 'x']
];

export function parseModeString(value: string): number {
	const trimmed = value.trim();
	if (/^[0-7]{3,4}$/.test(trimmed)) {
		return parseInt(trimmed, 8);
	}
	const pattern = /^([rwxst-]{9})([+]*)$/i;
	const match = pattern.exec(trimmed);
	if (!match) {
		throw new Error(`Invalid mode string: '${value}'`);
	}
	const chars = match[1].toLowerCase();
	let mode = 0;
	for (let i = 0; i < 9; i++) {
		if (chars[i] === 'r') {
			mode |= 0o400 >> i;
		} else if (chars[i] === 'w') {
			mode |= 0o200 >> i;
		} else if (chars[i] === 'x') {
			mode |= 0o100 >> i;
		} else if (chars[i] === 's') {
			if (i < 3) {
				mode |= 0o4000;
			} else if (i < 6) {
				mode |= 0o2000;
			}
		}
	}
	return mode;
}

export function formatMode(mode: number): string {
	let result = '';
	for (let i = 0; i < 9; i++) {
		const bit = 0o400 >> i;
		const ch = MODE_CHARS[Math.floor(i / 3)][i % 3];
		result += (mode & bit) !== 0 ? ch : '-';
	}
	return result;
}

export function isExecutable(mode: number): boolean {
	return (mode & 0o111) !== 0;
}

export function isWritable(mode: number): boolean {
	return (mode & 0o222) !== 0;
}

export function getPermissionInfo(mode: number): IPermissionInfo {
	return {
		mode,
		readable: formatMode(mode),
		writable: isWritable(mode),
		executable: isExecutable(mode),
		ownerRead: (mode & 0o400) !== 0,
		ownerWrite: (mode & 0o200) !== 0,
		ownerExec: (mode & 0o100) !== 0,
		groupRead: (mode & 0o040) !== 0,
		groupWrite: (mode & 0o020) !== 0,
		groupExec: (mode & 0o010) !== 0,
		otherRead: (mode & 0o004) !== 0,
		otherWrite: (mode & 0o002) !== 0,
		otherExec: (mode & 0o001) !== 0
	};
}

export class RemoteFilePermissions {
	async getMode(path: string): Promise<number> {
		const info = await statFs(path);
		return info.mode & 0o7777;
	}

	async getStat(path: string): Promise<Stats> {
		return statFs(path);
	}

	async chmod(path: string, mode: number | string): Promise<void> {
		const resolved = typeof mode === 'string' ? parseModeString(mode) : mode;
		await chmodFs(path, resolved);
	}

	async chown(path: string, uid: number | null, gid: number | null): Promise<void> {
		if (typeof process === 'undefined' || typeof process.getuid !== 'function') {
			throw new Error('chown is not supported on this platform');
		}
		await chownFs(path, uid ?? -1, gid ?? -1);
	}

	async makeExecutable(path: string): Promise<void> {
		const mode = await this.getMode(path);
		await chmodFs(path, mode | 0o111);
	}

	async makeReadOnly(path: string): Promise<void> {
		const mode = await this.getMode(path);
		await chmodFs(path, mode & ~0o222);
	}

	async applyPermissions(info: Stats | { mode: number }, mode: number | string): Promise<number> {
		const current = typeof (info as Stats).mode === 'number' ? (info as Stats).mode : info.mode;
		const resolved = typeof mode === 'string' ? parseModeString(mode) : mode;
		const applied = (current & 0o7777000) | (resolved & 0o7777);
		return applied;
	}

	async copyPermissions(source: string, destination: string): Promise<number> {
		const mode = await this.getMode(source);
		await chmodFs(destination, mode);
		return mode;
	}

	async ensureWritable(path: string): Promise<number> {
		const mode = await this.getMode(path);
		if (!isWritable(mode)) {
			await chmodFs(path, mode | 0o222);
			return mode | 0o222;
		}
		return mode;
	}

	async isExecutablePath(path: string): Promise<boolean> {
		const mode = await this.getMode(path);
		return isExecutable(mode);
	}

	compareModeString(mode: number, expected: string): boolean {
		return (mode & 0o777) === (parseModeString(expected) & 0o777);
	}
}
