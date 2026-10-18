/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Stats, constants, promises } from 'fs';
import { Barrier, retry } from '../../../base/common/async.js';
import { ResourceMap } from '../../../base/common/map.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { isEqual } from '../../../base/common/extpath.js';
import { DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { basename, dirname, join } from '../../../base/common/path.js';
import { isLinux, isWindows } from '../../../base/common/platform.js';
import { extUriBiasedIgnorePathCase, joinPath, basename as resourcesBasename, dirname as resourcesDirname } from '../../../base/common/resources.js';
import { newWriteableStream, ReadableStreamEvents } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { IDirent, Promises, RimRafMode, SymlinkSupport } from '../../../base/node/pfs.js';
import { localize } from '../../../nls.js';
import { createFileSystemProviderError, IFileAtomicReadOptions, IFileDeleteOptions, IFileOpenOptions, IFileOverwriteOptions, IFileReadStreamOptions, FileSystemProviderCapabilities, FileSystemProviderError, FileSystemProviderErrorCode, FileType, IFileWriteOptions, IFileSystemProviderWithFileAtomicReadCapability, IFileSystemProviderWithFileCloneCapability, IFileSystemProviderWithFileFolderCopyCapability, IFileSystemProviderWithFileReadStreamCapability, IFileSystemProviderWithFileReadWriteCapability, IFileSystemProviderWithOpenReadWriteCloseCapability, isFileOpenForWriteOptions, IStat, FilePermission, IFileSystemProviderWithFileAtomicWriteCapability, IFileSystemProviderWithFileAtomicDeleteCapability, IFileChange, IFileSystemProviderWithFileRealpathCapability } from '../common/files.js';
import { readFileIntoStream } from '../common/io.js';
import { AbstractNonRecursiveWatcherClient, AbstractUniversalWatcherClient, ILogMessage } from '../common/watcher.js';
import { AbstractDiskFileSystemProvider } from '../common/diskFileSystemProvider.js';
import { UniversalWatcherClient } from './watcher/watcherClient.js';
import { NodeJSWatcherClient } from './watcher/nodejs/nodejsClient.js';

export class DiskFileSystemProvider extends AbstractDiskFileSystemProvider implements
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileReadStreamCapability,
	IFileSystemProviderWithFileFolderCopyCapability,
	IFileSystemProviderWithFileAtomicReadCapability,
	IFileSystemProviderWithFileAtomicWriteCapability,
	IFileSystemProviderWithFileAtomicDeleteCapability,
	IFileSystemProviderWithFileCloneCapability,
	IFileSystemProviderWithFileRealpathCapability {

	private static TRACE_LOG_RESOURCE_LOCKS = false;


	readonly onDidChangeCapabilities = Event.None;

	private _capabilities: FileSystemProviderCapabilities | undefined;
	get capabilities(): FileSystemProviderCapabilities {
		if (!this._capabilities) {
			this._capabilities =
				FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileOpenReadWriteClose |
				FileSystemProviderCapabilities.FileReadStream |
				FileSystemProviderCapabilities.FileFolderCopy |
				FileSystemProviderCapabilities.FileWriteUnlock |
				FileSystemProviderCapabilities.FileAppend |
				FileSystemProviderCapabilities.FileAtomicRead |
				FileSystemProviderCapabilities.FileAtomicWrite |
				FileSystemProviderCapabilities.FileAtomicDelete |
				FileSystemProviderCapabilities.FileClone |
				FileSystemProviderCapabilities.FileRealpath;

			if (isLinux) {
				this._capabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
			}
		}

		return this._capabilities;
	}



	async stat(resource: URI): Promise<IStat> {
		try {
			const { stat, symbolicLink } = await SymlinkSupport.stat(this.toFilePath(resource));

			let permissions: FilePermission | undefined = undefined;
			if ((stat.mode & 0o200) === 0) {
				permissions = FilePermission.Locked;
			}
			if (
				stat.mode & constants.S_IXUSR ||
				stat.mode & constants.S_IXGRP ||
				stat.mode & constants.S_IXOTH
			) {
				permissions = (permissions ?? 0) | FilePermission.Executable;
			}

			return {
				type: this.toType(stat, symbolicLink),
				ctime: stat.birthtime.getTime(),
				mtime: stat.mtime.getTime(),
				size: stat.size,
				permissions
			};
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		}
	}

	private async statIgnoreError(resource: URI): Promise<IStat | undefined> {
		try {
			return await this.stat(resource);
		} catch (error) {
			return undefined;
		}
	}

	async realpath(resource: URI): Promise<string> {
		const filePath = this.toFilePath(resource);

		return Promises.realpath(filePath);
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		try {
			const children = await Promises.readdir(this.toFilePath(resource), { withFileTypes: true });

			const result: [string, FileType][] = [];
			await Promise.all(children.map(async child => {
				try {
					let type: FileType;
					if (child.isSymbolicLink()) {
						type = (await this.stat(joinPath(resource, child.name))).type;
					} else {
						type = this.toType(child);
					}

					result.push([child.name, type]);
				} catch (error) {
					this.logService.trace(error);
				}
			}));

			return result;
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		}
	}

	private toType(entry: Stats | IDirent, symbolicLink?: { dangling: boolean }): FileType {

		let type: FileType;
		if (symbolicLink?.dangling) {
			type = FileType.Unknown;
		} else if (entry.isFile()) {
			type = FileType.File;
		} else if (entry.isDirectory()) {
			type = FileType.Directory;
		} else {
			type = FileType.Unknown;
		}

		if (symbolicLink) {
			type |= FileType.SymbolicLink;
		}

		return type;
	}



	private readonly resourceLocks = new ResourceMap<Barrier>(resource => extUriBiasedIgnorePathCase.getComparisonKey(resource));

	private async createResourceLock(resource: URI): Promise<IDisposable> {
		const filePath = this.toFilePath(resource);
		this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - request to acquire resource lock (${filePath})`);

		let existingLock: Barrier | undefined = undefined;
		while (existingLock = this.resourceLocks.get(resource)) {
			this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - waiting for resource lock to be released (${filePath})`);
			await existingLock.wait();
		}

		const newLock = new Barrier();
		this.resourceLocks.set(resource, newLock);

		this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - new resource lock created (${filePath})`);

		return toDisposable(() => {
			this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - resource lock dispose() (${filePath})`);

			if (this.resourceLocks.get(resource) === newLock) {
				this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - resource lock removed from resource-lock map (${filePath})`);
				this.resourceLocks.delete(resource);
			}

			this.traceLock(`[Disk FileSystemProvider]: createResourceLock() - resource lock barrier open() (${filePath})`);
			newLock.open();
		});
	}

	async readFile(resource: URI, options?: IFileAtomicReadOptions): Promise<Uint8Array> {
		let lock: IDisposable | undefined = undefined;
		try {
			if (options?.atomic) {
				this.traceLock(`[Disk FileSystemProvider]: atomic read operation started (${this.toFilePath(resource)})`);

				lock = await this.createResourceLock(resource);
			}

			const filePath = this.toFilePath(resource);

			return await promises.readFile(filePath);
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		} finally {
			lock?.dispose();
		}
	}

	private traceLock(msg: string): void {
		if (DiskFileSystemProvider.TRACE_LOG_RESOURCE_LOCKS) {
			this.logService.trace(msg);
		}
	}

	readFileStream(resource: URI, opts: IFileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array> {
		const stream = newWriteableStream<Uint8Array>(data => VSBuffer.concat(data.map(data => VSBuffer.wrap(data))).buffer);

		readFileIntoStream(this, resource, stream, data => data.buffer, {
			...opts,
			bufferSize: 256 * 1024
		}, token);

		return stream;
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		if (opts?.atomic !== false && opts?.atomic?.postfix && await this.canWriteFileAtomic(resource)) {
			return this.doWriteFileAtomic(resource, joinPath(resourcesDirname(resource), `${resourcesBasename(resource)}${opts.atomic.postfix}`), content, opts);
		} else {
			return this.doWriteFile(resource, content, opts);
		}
	}

	private async canWriteFileAtomic(resource: URI): Promise<boolean> {
		try {
			const filePath = this.toFilePath(resource);
			const { symbolicLink } = await SymlinkSupport.stat(filePath);
			if (symbolicLink) {
				return false;
			}
		} catch (error) {
		}

		return true;
	}

	private async doWriteFileAtomic(resource: URI, tempResource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {


		const locks = new DisposableStore();

		try {
			locks.add(await this.createResourceLock(resource));
			locks.add(await this.createResourceLock(tempResource));

			await this.doWriteFile(tempResource, content, { ...opts, create: true, overwrite: true }, true );

			try {

				await this.rename(tempResource, resource, { overwrite: true });

			} catch (error) {

				try {
					await this.delete(tempResource, { recursive: false, useTrash: false, atomic: false });
				} catch (error) {
				}

				throw error;
			}
		} finally {
			locks.dispose();
		}
	}

	private async doWriteFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions, disableWriteLock?: boolean): Promise<void> {
		let handle: number | undefined = undefined;
		try {
			const filePath = this.toFilePath(resource);

			if (!opts.create || !opts.overwrite) {
				const fileExists = await Promises.exists(filePath);
				if (fileExists) {
					if (!opts.overwrite) {
						throw createFileSystemProviderError(localize('fileExists', "File already exists"), FileSystemProviderErrorCode.FileExists);
					}
				} else {
					if (!opts.create) {
						throw createFileSystemProviderError(localize('fileNotExists', "File does not exist"), FileSystemProviderErrorCode.FileNotFound);
					}
				}
			}

			handle = await this.open(resource, { create: true, append: opts.append, unlock: opts.unlock }, disableWriteLock);

			await this.write(handle, 0, content, 0, content.byteLength);
		} catch (error) {
			throw await this.toFileSystemProviderWriteError(resource, error);
		} finally {
			if (typeof handle === 'number') {
				await this.close(handle);
			}
		}
	}

	private readonly mapHandleToPos = new Map<number, number>();
	private readonly mapHandleToLock = new Map<number, IDisposable>();

	private readonly writeHandles = new Map<number, URI>();

	private static canFlush = true;

	static configureFlushOnWrite(enabled: boolean): void {
		DiskFileSystemProvider.canFlush = enabled;
	}

	async open(resource: URI, opts: IFileOpenOptions, disableWriteLock?: boolean): Promise<number> {
		const filePath = this.toFilePath(resource);

		let lock: IDisposable | undefined = undefined;
		if (isFileOpenForWriteOptions(opts) && !disableWriteLock) {
			lock = await this.createResourceLock(resource);
		}

		let fd: number | undefined = undefined;
		try {

			if (isFileOpenForWriteOptions(opts) && opts.unlock) {
				try {
					const { stat } = await SymlinkSupport.stat(filePath);
					if (!(stat.mode & 0o200 )) {
						await promises.chmod(filePath, stat.mode | 0o200);
					}
				} catch (error) {
					if (error.code !== 'ENOENT') {
						this.logService.trace(error);
					}
				}
			}

			if (isWindows && isFileOpenForWriteOptions(opts) && !opts.append) {
				try {

					fd = await Promises.open(filePath, 'r+');

					await Promises.ftruncate(fd, 0);
				} catch (error) {
					if (error.code !== 'ENOENT') {
						this.logService.trace(error);
					}

					if (typeof fd === 'number') {
						try {
							await Promises.close(fd);
						} catch (error) {
							this.logService.trace(error);
						}

						fd = undefined;
					}
				}
			}

			if (typeof fd !== 'number') {
				fd = await Promises.open(filePath, isFileOpenForWriteOptions(opts) ?
					(opts.append ? 'a' : 'w') :
					'r'
				);
			}

		} catch (error) {

			lock?.dispose();

			if (isFileOpenForWriteOptions(opts)) {
				throw await this.toFileSystemProviderWriteError(resource, error);
			} else {
				throw this.toFileSystemProviderError(error);
			}
		}

		this.mapHandleToPos.set(fd, 0);

		if (isFileOpenForWriteOptions(opts)) {
			this.writeHandles.set(fd, resource);
		}

		if (lock) {
			const previousLock = this.mapHandleToLock.get(fd);

			this.traceLock(`[Disk FileSystemProvider]: open() - storing lock for handle ${fd} (${filePath})`);
			this.mapHandleToLock.set(fd, lock);

			if (previousLock) {
				this.traceLock(`[Disk FileSystemProvider]: open() - disposing a previous lock that was still stored on same handle ${fd} (${filePath})`);
				previousLock.dispose();
			}
		}

		return fd;
	}

	async close(fd: number): Promise<void> {

		const lockForHandle = this.mapHandleToLock.get(fd);

		try {

			this.mapHandleToPos.delete(fd);

			if (this.writeHandles.delete(fd) && DiskFileSystemProvider.canFlush) {
				try {
					await Promises.fdatasync(fd);
				} catch (error) {
					DiskFileSystemProvider.configureFlushOnWrite(false);
					this.logService.error(error);
				}
			}

			return await Promises.close(fd);
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		} finally {
			if (lockForHandle) {
				if (this.mapHandleToLock.get(fd) === lockForHandle) {
					this.traceLock(`[Disk FileSystemProvider]: close() - resource lock removed from handle-lock map ${fd}`);
					this.mapHandleToLock.delete(fd);
				}

				this.traceLock(`[Disk FileSystemProvider]: close() - disposing lock for handle ${fd}`);
				lockForHandle.dispose();
			}
		}
	}

	async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const normalizedPos = this.normalizePos(fd, pos);

		let bytesRead: number | null = null;
		try {
			bytesRead = (await Promises.read(fd, data, offset, length, normalizedPos)).bytesRead;
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		} finally {
			this.updatePos(fd, normalizedPos, bytesRead);
		}

		return bytesRead;
	}

	private normalizePos(fd: number, pos: number): number | null {

		if (pos === this.mapHandleToPos.get(fd)) {
			return null;
		}

		return pos;
	}

	private updatePos(fd: number, pos: number | null, bytesLength: number | null): void {
		const lastKnownPos = this.mapHandleToPos.get(fd);
		if (typeof lastKnownPos === 'number') {

			if (typeof pos === 'number') {
			}

			else if (typeof bytesLength === 'number') {
				this.mapHandleToPos.set(fd, lastKnownPos + bytesLength);
			}

			else {
				this.mapHandleToPos.delete(fd);
			}
		}
	}

	async write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {

		return retry(() => this.doWrite(fd, pos, data, offset, length), 100 , 3 );
	}

	private async doWrite(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const normalizedPos = this.normalizePos(fd, pos);

		let bytesWritten: number | null = null;
		try {
			bytesWritten = (await Promises.write(fd, data, offset, length, normalizedPos)).bytesWritten;
		} catch (error) {
			throw await this.toFileSystemProviderWriteError(this.writeHandles.get(fd), error);
		} finally {
			this.updatePos(fd, normalizedPos, bytesWritten);
		}

		return bytesWritten;
	}



	async mkdir(resource: URI): Promise<void> {
		try {
			await promises.mkdir(this.toFilePath(resource));
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		}
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		try {
			const filePath = this.toFilePath(resource);
			if (opts.recursive) {
				let rmMoveToPath: string | undefined = undefined;
				if (opts?.atomic !== false && opts.atomic.postfix) {
					rmMoveToPath = join(dirname(filePath), `${basename(filePath)}${opts.atomic.postfix}`);
				}

				await Promises.rm(filePath, RimRafMode.MOVE, rmMoveToPath);
			} else {
				try {
					await promises.unlink(filePath);
				} catch (unlinkError) {


					if (unlinkError.code === 'EPERM' || unlinkError.code === 'EISDIR') {
						let isDirectory = false;
						try {
							const { stat, symbolicLink } = await SymlinkSupport.stat(filePath);
							isDirectory = stat.isDirectory() && !symbolicLink;
						} catch (statError) {
						}

						if (isDirectory) {
							await promises.rmdir(filePath);
						} else {
							throw unlinkError;
						}
					} else {
						throw unlinkError;
					}
				}
			}
		} catch (error) {
			throw this.toFileSystemProviderError(error);
		}
	}

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const fromFilePath = this.toFilePath(from);
		const toFilePath = this.toFilePath(to);

		if (fromFilePath === toFilePath) {
			return;
		}

		try {

			await this.validateMoveCopy(from, to, 'move', opts.overwrite);

			await Promises.rename(fromFilePath, toFilePath);
		} catch (error) {

			if (error.code === 'EINVAL' || error.code === 'EBUSY' || error.code === 'ENAMETOOLONG') {
				error = new Error(localize('moveError', "Unable to move '{0}' into '{1}' ({2}).", basename(fromFilePath), basename(dirname(toFilePath)), error.toString()));
			}

			throw this.toFileSystemProviderError(error);
		}
	}

	async copy(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> {
		const fromFilePath = this.toFilePath(from);
		const toFilePath = this.toFilePath(to);

		if (fromFilePath === toFilePath) {
			return;
		}

		try {

			await this.validateMoveCopy(from, to, 'copy', opts.overwrite);

			await Promises.copy(fromFilePath, toFilePath, { preserveSymlinks: true });
		} catch (error) {

			if (error.code === 'EINVAL' || error.code === 'EBUSY' || error.code === 'ENAMETOOLONG') {
				error = new Error(localize('copyError', "Unable to copy '{0}' into '{1}' ({2}).", basename(fromFilePath), basename(dirname(toFilePath)), error.toString()));
			}

			throw this.toFileSystemProviderError(error);
		}
	}

	private async validateMoveCopy(from: URI, to: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<void> {
		const fromFilePath = this.toFilePath(from);
		const toFilePath = this.toFilePath(to);

		let isSameResourceWithDifferentPathCase = false;
		const isPathCaseSensitive = !!(this.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);
		if (!isPathCaseSensitive) {
			isSameResourceWithDifferentPathCase = isEqual(fromFilePath, toFilePath, true );
		}

		if (isSameResourceWithDifferentPathCase) {

			if (mode === 'copy') {
				throw createFileSystemProviderError(localize('fileCopyErrorPathCase', "File cannot be copied to same path with different path case"), FileSystemProviderErrorCode.FileExists);
			}

			else if (mode === 'move') {
				return;
			}
		}


		const fromStat = await this.statIgnoreError(from);
		if (!fromStat) {
			throw createFileSystemProviderError(localize('fileMoveCopyErrorNotFound', "File to move/copy does not exist"), FileSystemProviderErrorCode.FileNotFound);
		}

		const toStat = await this.statIgnoreError(to);
		if (!toStat) {
			return;
		}

		if (!overwrite) {
			throw createFileSystemProviderError(localize('fileMoveCopyErrorExists', "File at target already exists and thus will not be moved/copied to unless overwrite is specified"), FileSystemProviderErrorCode.FileExists);
		}

		if ((fromStat.type & FileType.File) !== 0 && (toStat.type & FileType.File) !== 0) {
			return;
		} else {
			await this.delete(to, { recursive: true, useTrash: false, atomic: false });
		}
	}



	async cloneFile(from: URI, to: URI): Promise<void> {
		return this.doCloneFile(from, to, false );
	}

	private async doCloneFile(from: URI, to: URI, mkdir: boolean): Promise<void> {
		const fromFilePath = this.toFilePath(from);
		const toFilePath = this.toFilePath(to);

		const isPathCaseSensitive = !!(this.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);
		if (isEqual(fromFilePath, toFilePath, !isPathCaseSensitive)) {
			return;
		}


		const locks = new DisposableStore();

		try {
			locks.add(await this.createResourceLock(from));
			locks.add(await this.createResourceLock(to));

			if (mkdir) {
				await promises.mkdir(dirname(toFilePath), { recursive: true });
			}

			await promises.copyFile(fromFilePath, toFilePath);
		} catch (error) {
			if (error.code === 'ENOENT' && !mkdir) {
				return this.doCloneFile(from, to, true);
			}

			throw this.toFileSystemProviderError(error);
		} finally {
			locks.dispose();
		}
	}



	protected createUniversalWatcher(
		onChange: (changes: IFileChange[]) => void,
		onLogMessage: (msg: ILogMessage) => void,
		verboseLogging: boolean
	): AbstractUniversalWatcherClient {
		return new UniversalWatcherClient(changes => onChange(changes), msg => onLogMessage(msg), verboseLogging);
	}

	protected createNonRecursiveWatcher(
		onChange: (changes: IFileChange[]) => void,
		onLogMessage: (msg: ILogMessage) => void,
		verboseLogging: boolean
	): AbstractNonRecursiveWatcherClient {
		return new NodeJSWatcherClient(changes => onChange(changes), msg => onLogMessage(msg), verboseLogging);
	}



	private toFileSystemProviderError(error: NodeJS.ErrnoException): FileSystemProviderError {
		if (error instanceof FileSystemProviderError) {
			return error;
		}

		let resultError: Error | string = error;
		let code: FileSystemProviderErrorCode;
		switch (error.code) {
			case 'ENOENT':
				code = FileSystemProviderErrorCode.FileNotFound;
				break;
			case 'EISDIR':
				code = FileSystemProviderErrorCode.FileIsADirectory;
				break;
			case 'ENOTDIR':
				code = FileSystemProviderErrorCode.FileNotADirectory;
				break;
			case 'EEXIST':
				code = FileSystemProviderErrorCode.FileExists;
				break;
			case 'EPERM':
			case 'EACCES':
				code = FileSystemProviderErrorCode.NoPermissions;
				break;
			case 'ERR_UNC_HOST_NOT_ALLOWED':
				resultError = `${error.message}. Please update the 'security.allowedUNCHosts' setting if you want to allow this host.`;
				code = FileSystemProviderErrorCode.Unknown;
				break;
			default:
				code = FileSystemProviderErrorCode.Unknown;
		}

		return createFileSystemProviderError(resultError, code);
	}

	private async toFileSystemProviderWriteError(resource: URI | undefined, error: NodeJS.ErrnoException): Promise<FileSystemProviderError> {
		let fileSystemProviderWriteError = this.toFileSystemProviderError(error);

		if (resource && fileSystemProviderWriteError.code === FileSystemProviderErrorCode.NoPermissions) {
			try {
				const { stat } = await SymlinkSupport.stat(this.toFilePath(resource));
				if (!(stat.mode & 0o200 )) {
					fileSystemProviderWriteError = createFileSystemProviderError(error, FileSystemProviderErrorCode.FileWriteLocked);
				}
			} catch (error) {
				this.logService.trace(error);
			}
		}

		return fileSystemProviderWriteError;
	}

}
