import { lstat, readlink, symlink as symlinkFs, unlink, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ISymlinkInfo {
	readonly path: string;
	readonly target: string;
	readonly isAbsolute: boolean;
	readonly resolvedTarget: string;
}

export interface IResolveSymlinkOptions {
	readonly maxDepth?: number;
}

export class RemoteFileSymlink {
	private readonly _onDidChange = new Emitter<{ path: string; action: 'create' | 'remove' | 'resolve' }>();
	readonly onDidChange: Event<{ path: string; action: 'create' | 'remove' | 'resolve' }> = this._onDidChange.event;

	async isSymlink(path: string): Promise<boolean> {
		try {
			const info = await lstat(path);
			return info.isSymbolicLink();
		} catch {
			return false;
		}
	}

	async readLink(path: string): Promise<string> {
		return readlink(path);
	}

	async symlink(target: string, path: string, type?: 'file' | 'dir' | 'junction'): Promise<void> {
		await symlinkFs(target, path, type);
		this._onDidChange.fire({ path, action: 'create' });
	}

	async createLink(target: string, path: string, type?: 'file' | 'dir' | 'junction'): Promise<void> {
		return this.symlink(target, path, type);
	}

	async resolveSymlink(path: string, options: IResolveSymlinkOptions = {}): Promise<string> {
		const maxDepth = options.maxDepth ?? 10;
		let current = path;
		for (let depth = 0; depth < maxDepth; depth++) {
			if (!(await this.isSymlink(current))) {
				break;
			}
			const target = await readlink(current);
			current = resolve(dirname(current), target);
		}
		this._onDidChange.fire({ path, action: 'resolve' });
		return current;
	}

	async getInfo(path: string): Promise<ISymlinkInfo | null> {
		if (!(await this.isSymlink(path))) {
			return null;
		}
		const target = await readlink(path);
		const isAbsolute = target.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(target);
		const resolvedTarget = isAbsolute ? target : resolve(dirname(path), target);
		return { path, target, isAbsolute, resolvedTarget };
	}

	async unlink(path: string): Promise<boolean> {
		if (!(await this.isSymlink(path))) {
			return false;
		}
		await unlink(path);
		this._onDidChange.fire({ path, action: 'remove' });
		return true;
	}

	async getTargetType(path: string): Promise<'file' | 'dir' | 'unknown'> {
		const info = await this.getInfo(path);
		if (!info) {
			return 'unknown';
		}
		try {
			const targetInfo = await lstat(info.resolvedTarget);
			return targetInfo.isDirectory() ? 'dir' : 'file';
		} catch {
			return 'unknown';
		}
	}

	async dereference(path: string): Promise<string | null> {
		try {
			return await realpath(path);
		} catch {
			return null;
		}
	}

	async isBroken(path: string): Promise<boolean> {
		const info = await this.getInfo(path);
		if (!info) {
			return false;
		}
		return (await this.dereference(path)) === null;
	}

	async remove(path: string): Promise<void> {
		await this.unlink(path);
	}
}
