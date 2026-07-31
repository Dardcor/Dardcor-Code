/**
 * Dardcor Code - File Metadata & Status Builder (Task 109)
 */

import type { Stats } from 'node:fs';
import { IFileStat } from './file-service.js';
import { URI } from '../../core/types/uri.js';

export class FileStat {
	private constructor() {}

	public static createFile(resource: URI, name?: string, size: number = 0, mtime: number = Date.now()): IFileStat {
		return {
			resource,
			name: name ?? FileStat._getName(resource),
			isDirectory: false,
			isFile: true,
			size,
			mtime
		};
	}

	public static createDirectory(resource: URI, name?: string, mtime: number = Date.now()): IFileStat {
		return {
			resource,
			name: name ?? FileStat._getName(resource),
			isDirectory: true,
			isFile: false,
			size: 0,
			mtime
		};
	}

	public static fromNode(resource: URI, stats: Stats): IFileStat {
		const isDirectory = stats.isDirectory();
		return {
			resource,
			name: FileStat._getName(resource),
			isDirectory,
			isFile: !isDirectory,
			size: isDirectory ? 0 : stats.size,
			mtime: Math.max(stats.mtimeMs, 0)
		};
	}

	private static _getName(resource: URI): string {
		const path = resource.path.replace(/\/+$/, '');
		const idx = path.lastIndexOf('/');
		return decodeURIComponent(idx === -1 ? path : path.substring(idx + 1));
	}
}

export function toFileStat(resource: URI, stats: Stats): IFileStat {
	return FileStat.fromNode(resource, stats);
}

export function fileStatsEqual(a: IFileStat | undefined, b: IFileStat | undefined): boolean {
	if (!a || !b) {
		return a === b;
	}
	return a.resource.toString() === b.resource.toString() && a.size === b.size && a.mtime === b.mtime;
}

export function fileSizeMatches(a: IFileStat, b: IFileStat): boolean {
	return a.size === b.size && a.mtime === b.mtime;
}
