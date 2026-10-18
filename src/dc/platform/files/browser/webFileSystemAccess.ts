/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export namespace WebFileSystemAccess {

	export function supported(obj: typeof globalThis): boolean {
		if (typeof (obj as typeof globalThis & { showDirectoryPicker?: unknown })?.showDirectoryPicker === 'function') {
			return true;
		}

		return false;
	}

	export function isFileSystemHandle(handle: unknown): handle is FileSystemHandle {
		const candidate = handle as FileSystemHandle | undefined;
		if (!candidate) {
			return false;
		}

		return typeof candidate.kind === 'string' && typeof candidate.queryPermission === 'function' && typeof candidate.requestPermission === 'function';
	}

	export function isFileSystemFileHandle(handle: FileSystemHandle): handle is FileSystemFileHandle {
		return handle.kind === 'file';
	}

	export function isFileSystemDirectoryHandle(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
		return handle.kind === 'directory';
	}
}

export namespace WebFileSystemObserver {

	export function supported(obj: typeof globalThis): boolean {
		return typeof (obj as typeof globalThis & { FileSystemObserver?: unknown })?.FileSystemObserver === 'function';
	}
}

export interface FileSystemObserver {
	new(callback: (records: FileSystemObserverRecord[], observer: FileSystemObserver) => void): FileSystemObserver;

	observe(handle: FileSystemHandle): Promise<void>;
	observe(handle: FileSystemDirectoryHandle, options?: { recursive: boolean }): Promise<void>;

	unobserve(handle: FileSystemHandle): void;
	disconnect(): void;
}

export interface FileSystemObserverRecord {

	readonly root: FileSystemHandle;

	readonly changedHandle: FileSystemHandle;

	readonly relativePathComponents: string[];

	readonly type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored';

	readonly relativePathMovedFrom?: string[];
}

export declare class FileSystemObserver {

	constructor(callback: (records: FileSystemObserverRecord[], observer: FileSystemObserver) => void);

	observe(handle: FileSystemHandle, options?: { recursive: boolean }): Promise<void>;
}
