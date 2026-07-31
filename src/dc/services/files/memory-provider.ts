/**
 * Dardcor Code - In-Memory Virtual FileSystem Provider
 */

import { IFileSystemProvider, IFileStat, FileChangeEvent, FileChangeType } from './file-service.js';
import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';

interface MemoryNode {
	name: string;
	isDir: boolean;
	data?: Uint8Array;
	mtime: number;
	children?: Map<string, MemoryNode>;
}

export class MemoryFileSystemProvider implements IFileSystemProvider {
	private readonly _emitter = new Emitter<FileChangeEvent[]>();
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

	private readonly _root: MemoryNode = {
		name: '',
		isDir: true,
		mtime: Date.now(),
		children: new Map()
	};

	async stat(resource: URI): Promise<IFileStat> {
		const node = this._lookup(resource.path);
		if (!node) {
			throw new Error(`File not found: ${resource.path}`);
		}
		return {
			resource,
			name: node.name,
			isDirectory: node.isDir,
			isFile: !node.isDir,
			size: node.data ? node.data.byteLength : 0,
			mtime: node.mtime
		};
	}

	async readdir(resource: URI): Promise<[string, IFileStat][]> {
		const node = this._lookup(resource.path);
		if (!node || !node.isDir || !node.children) {
			return [];
		}
		const result: [string, IFileStat][] = [];
		for (const [name, child] of node.children.entries()) {
			result.push([
				name,
				{
					resource: URI.parse(`${resource.scheme}://${resource.authority}${resource.path}/${name}`),
					name,
					isDirectory: child.isDir,
					isFile: !child.isDir,
					size: child.data ? child.data.byteLength : 0,
					mtime: child.mtime
				}
			]);
		}
		return result;
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const node = this._lookup(resource.path);
		if (!node || node.isDir || !node.data) {
			throw new Error(`File not found: ${resource.path}`);
		}
		return node.data;
	}

	async writeFile(resource: URI, content: Uint8Array, _options: { create: boolean; overwrite: boolean }): Promise<void> {
		const parts = resource.path.split('/').filter(Boolean);
		const fileName = parts.pop()!;
		const parentPath = '/' + parts.join('/');
		let parent = this._lookup(parentPath);
		if (!parent) {
			await this.mkdir(URI.parse(`${resource.scheme}://${resource.authority}${parentPath}`));
			parent = this._lookup(parentPath)!;
		}

		let node = parent.children!.get(fileName);
		const exists = !!node;
		if (!node) {
			node = { name: fileName, isDir: false, mtime: Date.now(), data: content };
			parent.children!.set(fileName, node);
		} else {
			node.data = content;
			node.mtime = Date.now();
		}

		this._emitter.fire([{ resource, type: exists ? FileChangeType.Updated : FileChangeType.Added }]);
	}

	async delete(resource: URI, _options: { recursive: boolean }): Promise<void> {
		const parts = resource.path.split('/').filter(Boolean);
		const fileName = parts.pop()!;
		const parentPath = '/' + parts.join('/');
		const parent = this._lookup(parentPath);
		if (parent && parent.children) {
			parent.children.delete(fileName);
			this._emitter.fire([{ resource, type: FileChangeType.Deleted }]);
		}
	}

	async mkdir(resource: URI): Promise<void> {
		const parts = resource.path.split('/').filter(Boolean);
		let current = this._root;
		for (const part of parts) {
			let child = current.children!.get(part);
			if (!child) {
				child = { name: part, isDir: true, mtime: Date.now(), children: new Map() };
				current.children!.set(part, child);
			}
			current = child;
		}
	}

	private _lookup(path: string): MemoryNode | undefined {
		const parts = path.split('/').filter(Boolean);
		let current = this._root;
		for (const part of parts) {
			if (!current.isDir || !current.children) return undefined;
			const next = current.children.get(part);
			if (!next) return undefined;
			current = next;
		}
		return current;
	}
}
