import { readdir, stat, mkdir, copyFile as copyFileFs, rename, rm } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ICopyResult {
	readonly copied: number;
	readonly bytes: number;
	readonly source: string;
	readonly destination: string;
}

export type CopyFilter = (relativePath: string, isDirectory: boolean) => boolean;

export interface ICopyOptions {
	readonly filter?: CopyFilter;
	readonly overwrite?: boolean;
	readonly preserveTimestamps?: boolean;
}

export const DEFAULT_COPY_FILTER: CopyFilter = (relativePath, isDirectory) => {
	const name = relativePath.split('/').pop() ?? relativePath;
	return !isDirectory || (name !== '.git' && name !== 'node_modules' && name !== '.trash');
};

export class RemoteFileCopy {
	private readonly _onDidCopyFile = new Emitter<{ source: string; destination: string }>();
	readonly onDidCopyFile: Event<{ source: string; destination: string }> = this._onDidCopyFile.event;

	async copyFile(source: string, destination: string, overwrite = true): Promise<ICopyResult> {
		const sourceStat = await stat(source);
		if (!sourceStat.isFile()) {
			throw new Error(`Source is not a file: ${source}`);
		}
		await mkdir(dirname(destination), { recursive: true });
		try {
			await copyFileFs(source, destination);
		} catch (error) {
			if (!overwrite && (error as NodeJS.ErrnoException).code === 'EEXIST') {
				throw error;
			}
			throw error;
		}
		this._onDidCopyFile.fire({ source, destination });
		return { copied: 1, bytes: sourceStat.size, source, destination };
	}

	async copyDirectory(source: string, destination: string, options: ICopyOptions = {}): Promise<ICopyResult> {
		const sourceStat = await stat(source);
		if (!sourceStat.isDirectory()) {
			throw new Error(`Source is not a directory: ${source}`);
		}
		await mkdir(destination, { recursive: true });
		const filter = options.filter ?? DEFAULT_COPY_FILTER;
		const result: ICopyResult = { copied: 0, bytes: 0, source, destination };
		await this._walkCopy(source, destination, source, filter, options, result);
		return result;
	}

	async moveFile(source: string, destination: string, overwrite = true): Promise<ICopyResult> {
		const sourceStat = await stat(source);
		await mkdir(dirname(destination), { recursive: true });
		if (!overwrite) {
			try {
				await stat(destination);
				throw new Error(`Destination already exists: ${destination}`);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					throw error;
				}
			}
		}
		try {
			await rename(source, destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'EXDEV') {
				const copied = await this.copyFile(source, destination, overwrite);
				await rm(source, { force: true });
				return copied;
			}
			throw error;
		}
		return { copied: 1, bytes: sourceStat.size, source, destination };
	}

	async copy(src: string, dest: string, options: ICopyOptions = {}): Promise<ICopyResult> {
		const info = await stat(src);
		if (info.isDirectory()) {
			return this.copyDirectory(src, dest, options);
		}
		return this.copyFile(src, dest, options.overwrite ?? true);
	}

	async exists(path: string): Promise<boolean> {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	}

	private async _walkCopy(
		currentSource: string,
		currentDest: string,
		rootSource: string,
		filter: CopyFilter,
		options: ICopyOptions,
		result: ICopyResult
	): Promise<void> {
		const entries = await readdir(currentSource, { withFileTypes: true });
		for (const entry of entries) {
			const sourcePath = join(currentSource, entry.name);
			const destPath = join(currentDest, entry.name);
			const relPath = sourcePath.slice(rootSource.length + 1).replace(/\\/g, '/');
			if (entry.isDirectory()) {
				if (!filter(relPath, true)) {
					continue;
				}
				await mkdir(destPath, { recursive: true });
				await this._walkCopy(sourcePath, destPath, rootSource, filter, options, result);
			} else if (entry.isFile()) {
				if (!filter(relPath, false)) {
					continue;
				}
				try {
					await copyFileFs(sourcePath, destPath);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === 'EEXIST' && !(options.overwrite ?? true)) {
						continue;
					}
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
						throw error;
					}
				}
				const info = await stat(sourcePath);
				(result as any).copied++;
				(result as any).bytes += info.size;
				this._onDidCopyFile.fire({ source: sourcePath, destination: destPath });
			}
		}
	}

	async copyWithProgress(source: string, destination: string, onProgress: (copied: number, bytes: number, total: number) => void): Promise<ICopyResult> {
		const total = await this.countBytes(source);
		const result: ICopyResult = { copied: 0, bytes: 0, source, destination };
		await this._walkCopy(source, destination, source, DEFAULT_COPY_FILTER, {}, result);
		onProgress(result.copied, result.bytes, total);
		return result;
	}

	async countBytes(source: string): Promise<number> {
		const info = await stat(source);
		if (info.isFile()) {
			return info.size;
		}
		if (!info.isDirectory()) {
			return 0;
		}
		let total = 0;
		const entries = await readdir(source, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.isDirectory()) {
				total += await this.countBytes(join(source, entry.name));
			} else if (entry.isFile()) {
				const fileInfo = await stat(join(source, entry.name));
				total += fileInfo.size;
			}
		}
		return total;
	}

	flattenResult(result: ICopyResult): { copied: number; bytes: number } {
		return { copied: result.copied, bytes: result.bytes };
	}

	getDestinationName(source: string, destinationDir: string): string {
		return join(destinationDir, basename(source));
	}
}
