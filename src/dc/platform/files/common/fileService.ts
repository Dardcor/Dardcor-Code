/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../base/common/arrays.js';
import { Promises, ResourceQueue } from '../../../base/common/async.js';
import { bufferedStreamToBuffer, bufferToReadable, newWriteableBufferStream, readableToBuffer, streamToBuffer, VSBuffer, VSBufferReadable, VSBufferReadableBufferedStream, VSBufferReadableStream } from '../../../base/common/buffer.js';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Emitter } from '../../../base/common/event.js';
import { hash } from '../../../base/common/hash.js';
import { Iterable } from '../../../base/common/iterator.js';
import { Disposable, DisposableStore, dispose, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { TernarySearchTree } from '../../../base/common/ternarySearchTree.js';
import { Schemas } from '../../../base/common/network.js';
import { mark } from '../../../base/common/performance.js';
import { extUri, extUriIgnorePathCase, IExtUri, isAbsolutePath } from '../../../base/common/resources.js';
import { consumeStream, isReadableBufferedStream, isReadableStream, listenStream, newWriteableStream, peekReadable, peekStream, transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { ensureFileSystemProviderError, etag, ETAG_DISABLED, FileChangesEvent, IFileDeleteOptions, FileOperation, FileOperationError, FileOperationEvent, FileOperationResult, FilePermission, FileSystemProviderCapabilities, FileSystemProviderErrorCode, FileType, hasFileAppendCapability, hasFileAtomicReadCapability, hasFileFolderCopyCapability, hasFileReadStreamCapability, hasOpenReadWriteCloseCapability, hasReadWriteCapability, ICreateFileOptions, IFileContent, IFileService, IFileStat, IFileStatWithMetadata, IFileStreamContent, IFileSystemProvider, IFileSystemProviderActivationEvent, IFileSystemProviderCapabilitiesChangeEvent, IFileSystemProviderRegistrationEvent, IFileSystemProviderWithFileAtomicReadCapability, IFileSystemProviderWithFileReadStreamCapability, IFileSystemProviderWithFileReadWriteCapability, IFileSystemProviderWithOpenReadWriteCloseCapability, IReadFileOptions, IReadFileStreamOptions, IResolveFileOptions, IFileStatResult, IFileStatResultWithMetadata, IResolveMetadataFileOptions, IStat, IFileStatWithPartialMetadata, IWatchOptions, IWriteFileOptions, NotModifiedSinceFileOperationError, toFileOperationResult, toFileSystemProviderErrorCode, hasFileCloneCapability, TooLargeFileOperationError, hasFileAtomicDeleteCapability, hasFileAtomicWriteCapability, IWatchOptionsWithCorrelation, IFileSystemWatcher, IWatchOptionsWithoutCorrelation, hasFileRealpathCapability } from './files.js';
import { readFileIntoStream } from './io.js';
import { ILogService } from '../../log/common/log.js';
import { ErrorNoTelemetry } from '../../../base/common/errors.js';

export class FileService extends Disposable implements IFileService {

	declare readonly _serviceBrand: undefined;

	private readonly BUFFER_SIZE = 256 * 1024;

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}


	private readonly _onDidChangeFileSystemProviderRegistrations = this._register(new Emitter<IFileSystemProviderRegistrationEvent>());
	readonly onDidChangeFileSystemProviderRegistrations = this._onDidChangeFileSystemProviderRegistrations.event;

	private readonly _onWillActivateFileSystemProvider = this._register(new Emitter<IFileSystemProviderActivationEvent>());
	readonly onWillActivateFileSystemProvider = this._onWillActivateFileSystemProvider.event;

	private readonly _onDidChangeFileSystemProviderCapabilities = this._register(new Emitter<IFileSystemProviderCapabilitiesChangeEvent>());
	readonly onDidChangeFileSystemProviderCapabilities = this._onDidChangeFileSystemProviderCapabilities.event;

	private readonly provider = new Map<string, IFileSystemProvider>();

	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
		if (this.provider.has(scheme)) {
			throw new Error(`A filesystem provider for the scheme '${scheme}' is already registered.`);
		}

		mark(`code/registerFilesystem/${scheme}`);

		const providerDisposables = new DisposableStore();

		this.provider.set(scheme, provider);
		this._onDidChangeFileSystemProviderRegistrations.fire({ added: true, scheme, provider });

		providerDisposables.add(provider.onDidChangeFile(changes => {
			const event = new FileChangesEvent(changes, !this.isPathCaseSensitive(provider));

			this.internalOnDidFilesChange.fire(event);

			if (!event.hasCorrelation()) {
				this._onDidUncorrelatedFilesChange.fire(event);
			}
		}));
		if (typeof provider.onDidWatchError === 'function') {
			providerDisposables.add(provider.onDidWatchError(error => this._onDidWatchError.fire(new Error(error))));
		}
		providerDisposables.add(provider.onDidChangeCapabilities(() => this._onDidChangeFileSystemProviderCapabilities.fire({ provider, scheme })));

		return toDisposable(() => {
			this._onDidChangeFileSystemProviderRegistrations.fire({ added: false, scheme, provider });
			this.provider.delete(scheme);

			dispose(providerDisposables);
		});
	}

	getProvider(scheme: string): IFileSystemProvider | undefined {
		return this.provider.get(scheme);
	}

	async activateProvider(scheme: string): Promise<void> {

		const joiners: Promise<void>[] = [];
		this._onWillActivateFileSystemProvider.fire({
			scheme,
			join(promise) {
				joiners.push(promise);
			},
		});

		if (this.provider.has(scheme)) {
			return;
		}

		await Promises.settled(joiners);
	}

	async canHandleResource(resource: URI): Promise<boolean> {

		await this.activateProvider(resource.scheme);

		return this.hasProvider(resource);
	}

	hasProvider(resource: URI): boolean {
		return this.provider.has(resource.scheme);
	}

	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
		const provider = this.provider.get(resource.scheme);

		return !!(provider && (provider.capabilities & capability));
	}

	listCapabilities(): Iterable<{ scheme: string; capabilities: FileSystemProviderCapabilities }> {
		return Iterable.map(this.provider, ([scheme, provider]) => ({ scheme, capabilities: provider.capabilities }));
	}

	protected async withProvider(resource: URI): Promise<IFileSystemProvider> {

		if (!isAbsolutePath(resource)) {
			throw new FileOperationError(localize('invalidPath', "Unable to resolve filesystem provider with relative file path '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_INVALID_PATH);
		}

		await this.activateProvider(resource.scheme);

		const provider = this.provider.get(resource.scheme);
		if (!provider) {
			const error = new ErrorNoTelemetry();
			error.message = localize('noProviderFound', "ENOPRO: No file system provider found for resource '{0}'", resource.toString());

			throw error;
		}

		return provider;
	}

	private async withReadProvider(resource: URI): Promise<IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability> {
		const provider = await this.withProvider(resource);

		if (hasOpenReadWriteCloseCapability(provider) || hasReadWriteCapability(provider) || hasFileReadStreamCapability(provider)) {
			return provider;
		}

		throw new Error(`Filesystem provider for scheme '${resource.scheme}' neither has FileReadWrite, FileReadStream nor FileOpenReadWriteClose capability which is needed for the read operation.`);
	}

	private async withWriteProvider(resource: URI): Promise<IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability> {
		const provider = await this.withProvider(resource);

		if (hasOpenReadWriteCloseCapability(provider) || hasReadWriteCapability(provider)) {
			return provider;
		}

		throw new Error(`Filesystem provider for scheme '${resource.scheme}' neither has FileReadWrite nor FileOpenReadWriteClose capability which is needed for the write operation.`);
	}



	private readonly _onDidRunOperation = this._register(new Emitter<FileOperationEvent>());
	readonly onDidRunOperation = this._onDidRunOperation.event;



	async resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		try {
			return await this.doResolveFile(resource, options);
		} catch (error) {

			if (toFileSystemProviderErrorCode(error) === FileSystemProviderErrorCode.FileNotFound) {
				throw new FileOperationError(localize('fileNotFoundError', "Unable to resolve nonexistent file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_NOT_FOUND);
			}

			throw ensureFileSystemProviderError(error);
		}
	}

	private async doResolveFile(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		const provider = await this.withProvider(resource);
		const isPathCaseSensitive = this.isPathCaseSensitive(provider);

		const resolveTo = options?.resolveTo;
		const resolveSingleChildDescendants = options?.resolveSingleChildDescendants;
		const resolveMetadata = options?.resolveMetadata;

		const stat = await provider.stat(resource);

		let trie: TernarySearchTree<URI, boolean> | undefined;

		return this.toFileStat(provider, resource, stat, undefined, !!resolveMetadata, (stat, siblings) => {

			if (!trie) {
				trie = TernarySearchTree.forUris<true>(() => !isPathCaseSensitive);
				trie.set(resource, true);
				if (resolveTo) {
					trie.fill(true, resolveTo);
				}
			}

			if (trie.get(stat.resource) || trie.findSuperstr(stat.resource.with({ query: null, fragment: null } ))) {
				return true;
			}

			if (stat.isDirectory && resolveSingleChildDescendants) {
				return siblings === 1;
			}

			return false;
		});
	}

	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat | { type: FileType } & Partial<IStat>, siblings: number | undefined, resolveMetadata: boolean, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStat>;
	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat, siblings: number | undefined, resolveMetadata: true, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStatWithMetadata>;
	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat | { type: FileType } & Partial<IStat>, siblings: number | undefined, resolveMetadata: boolean, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStat> {
		const { providerExtUri } = this.getExtUri(provider);

		const fileStat: IFileStat = {
			resource,
			name: providerExtUri.basename(resource),
			isFile: (stat.type & FileType.File) !== 0,
			isDirectory: (stat.type & FileType.Directory) !== 0,
			isSymbolicLink: (stat.type & FileType.SymbolicLink) !== 0,
			mtime: stat.mtime,
			ctime: stat.ctime,
			size: stat.size,
			readonly: Boolean((stat.permissions ?? 0) & FilePermission.Readonly) || Boolean(provider.capabilities & FileSystemProviderCapabilities.Readonly),
			locked: Boolean((stat.permissions ?? 0) & FilePermission.Locked),
			executable: Boolean((stat.permissions ?? 0) & FilePermission.Executable),
			etag: etag({ mtime: stat.mtime, size: stat.size }),
			children: undefined
		};

		if (fileStat.isDirectory && recurse(fileStat, siblings)) {
			try {
				const entries = await provider.readdir(resource);
				const resolvedEntries = await Promises.settled(entries.map(async ([name, type]) => {
					try {
						const childResource = providerExtUri.joinPath(resource, name);
						const childStat = resolveMetadata ? await provider.stat(childResource) : { type };

						return await this.toFileStat(provider, childResource, childStat, entries.length, resolveMetadata, recurse);
					} catch (error) {
						this.logService.trace(error);

						return null;
					}
				}));

				fileStat.children = coalesce(resolvedEntries);
			} catch (error) {
				this.logService.trace(error);

				fileStat.children = [];
			}

			return fileStat;
		}

		return fileStat;
	}

	async resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions }[]): Promise<IFileStatResult[]>;
	async resolveAll(toResolve: { resource: URI; options: IResolveMetadataFileOptions }[]): Promise<IFileStatResultWithMetadata[]>;
	async resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions }[]): Promise<IFileStatResult[]> {
		return Promises.settled(toResolve.map(async entry => {
			try {
				return { stat: await this.doResolveFile(entry.resource, entry.options), success: true };
			} catch (error) {
				this.logService.trace(error);

				return { stat: undefined, success: false };
			}
		}));
	}

	async stat(resource: URI): Promise<IFileStatWithPartialMetadata> {
		const provider = await this.withProvider(resource);

		const stat = await provider.stat(resource);

		return this.toFileStat(provider, resource, stat, undefined, true, () => false );
	}

	async realpath(resource: URI): Promise<URI | undefined> {
		const provider = await this.withProvider(resource);

		if (hasFileRealpathCapability(provider)) {
			const realpath = await provider.realpath(resource);

			return resource.with({ path: realpath });
		}

		return undefined;
	}

	async exists(resource: URI): Promise<boolean> {
		const provider = await this.withProvider(resource);

		try {
			const stat = await provider.stat(resource);

			return !!stat;
		} catch (error) {
			return false;
		}
	}



	async canCreateFile(resource: URI, options?: ICreateFileOptions): Promise<Error | true> {
		try {
			await this.doValidateCreateFile(resource, options);
		} catch (error) {
			return error;
		}

		return true;
	}

	private async doValidateCreateFile(resource: URI, options?: ICreateFileOptions): Promise<void> {

		if (!options?.overwrite && await this.exists(resource)) {
			throw new FileOperationError(localize('fileExists', "Unable to create file '{0}' that already exists when overwrite flag is not set", this.resourceForError(resource)), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}
	}

	async createFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream = VSBuffer.fromString(''), options?: ICreateFileOptions): Promise<IFileStatWithMetadata> {

		await this.doValidateCreateFile(resource, options);

		const fileStat = await this.writeFile(resource, bufferOrReadableOrStream);

		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	async writeFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(resource), resource);
		const { providerExtUri } = this.getExtUri(provider);

		let writeFileOptions = options;
		if (hasFileAtomicWriteCapability(provider) && !writeFileOptions?.atomic) {
			const enforcedAtomicWrite = provider.enforceAtomicWriteFile?.(resource);
			if (enforcedAtomicWrite) {
				writeFileOptions = { ...options, atomic: enforcedAtomicWrite };
			}
		}

		try {

			let { stat, buffer: bufferOrReadableOrStreamOrBufferedStream } = await this.validateWriteFile(provider, resource, bufferOrReadableOrStream, writeFileOptions);

			if (!stat) {
				await this.mkdirp(provider, providerExtUri.dirname(resource));
			}

			if (!bufferOrReadableOrStreamOrBufferedStream) {
				bufferOrReadableOrStreamOrBufferedStream = await this.peekBufferForWriting(provider, bufferOrReadableOrStream);
			}

			if (
				!hasOpenReadWriteCloseCapability(provider) ||
				(hasReadWriteCapability(provider) && bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer) ||
				(hasReadWriteCapability(provider) && hasFileAtomicWriteCapability(provider) && writeFileOptions?.atomic)
			) {
				await this.doWriteUnbuffered(provider, resource, writeFileOptions, bufferOrReadableOrStreamOrBufferedStream);
			}

			else {
				await this.doWriteBuffered(provider, resource, writeFileOptions, bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer ? bufferToReadable(bufferOrReadableOrStreamOrBufferedStream) : bufferOrReadableOrStreamOrBufferedStream);
			}

			this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.WRITE));
		} catch (error) {
			throw new FileOperationError(localize('err.write', "Unable to write file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString()), toFileOperationResult(error), writeFileOptions);
		}

		return this.resolve(resource, { resolveMetadata: true });
	}


	private async peekBufferForWriting(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream): Promise<VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream> {
		let peekResult: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream;
		if (hasReadWriteCapability(provider) && !(bufferOrReadableOrStream instanceof VSBuffer)) {
			if (isReadableStream(bufferOrReadableOrStream)) {
				const bufferedStream = await peekStream(bufferOrReadableOrStream, 3);
				if (bufferedStream.ended) {
					peekResult = VSBuffer.concat(bufferedStream.buffer);
				} else {
					peekResult = bufferedStream;
				}
			} else {
				peekResult = peekReadable(bufferOrReadableOrStream, data => VSBuffer.concat(data), 3);
			}
		} else {
			peekResult = bufferOrReadableOrStream;
		}

		return peekResult;
	}

	private async validateWriteFile(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<{ stat: IStat | undefined; buffer: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream | undefined }> {

		const unlock = !!options?.unlock;
		if (unlock && !(provider.capabilities & FileSystemProviderCapabilities.FileWriteUnlock)) {
			throw new Error(localize('writeFailedUnlockUnsupported', "Unable to unlock file '{0}' because provider does not support it.", this.resourceForError(resource)));
		}

		if (options?.append && !hasFileAppendCapability(provider)) {
			throw new FileOperationError(localize('err.noAppend', "Filesystem provider for scheme '{0}' does not does not support append", this.resourceForError(resource)), FileOperationResult.FILE_PERMISSION_DENIED);
		}

		const atomic = !!options?.atomic;
		if (atomic) {
			if (!(provider.capabilities & FileSystemProviderCapabilities.FileAtomicWrite)) {
				throw new Error(localize('writeFailedAtomicUnsupported1', "Unable to atomically write file '{0}' because provider does not support it.", this.resourceForError(resource)));
			}

			if (!(provider.capabilities & FileSystemProviderCapabilities.FileReadWrite)) {
				throw new Error(localize('writeFailedAtomicUnsupported2', "Unable to atomically write file '{0}' because provider does not support unbuffered writes.", this.resourceForError(resource)));
			}

			if (unlock) {
				throw new Error(localize('writeFailedAtomicUnlock', "Unable to unlock file '{0}' because atomic write is enabled.", this.resourceForError(resource)));
			}
		}

		let stat: IStat | undefined = undefined;
		try {
			stat = await provider.stat(resource);
		} catch (error) {
			return Object.create(null);
		}

		if ((stat.type & FileType.Directory) !== 0) {
			throw new FileOperationError(localize('fileIsDirectoryWriteError', "Unable to write file '{0}' that is actually a directory", this.resourceForError(resource)), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		this.throwIfFileIsReadonly(resource, stat);

		let buffer: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream | undefined;
		if (
			typeof options?.mtime === 'number' && typeof options.etag === 'string' && options.etag !== ETAG_DISABLED &&
			typeof stat.mtime === 'number' && typeof stat.size === 'number' &&
			options.mtime < stat.mtime && options.etag !== etag({ mtime: options.mtime , size: stat.size })
		) {
			buffer = await this.peekBufferForWriting(provider, bufferOrReadableOrStream);
			if (buffer instanceof VSBuffer && buffer.byteLength === stat.size) {
				try {
					const { value } = await this.readFile(resource, { limits: { size: stat.size } });
					if (buffer.equals(value)) {
						return { stat, buffer };
					}
				} catch (error) {
				}
			}

			throw new FileOperationError(localize('fileModifiedError', "File Modified Since"), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}

		return { stat, buffer };
	}

	async readFile(resource: URI, options?: IReadFileOptions, token?: CancellationToken): Promise<IFileContent> {
		const provider = await this.withReadProvider(resource);

		if (options?.atomic) {
			return this.doReadFileAtomic(provider, resource, options, token);
		}

		return this.doReadFile(provider, resource, options, token);
	}

	private async doReadFileAtomic(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileOptions, token?: CancellationToken): Promise<IFileContent> {
		return new Promise<IFileContent>((resolve, reject) => {
			this.writeQueue.queueFor(resource, async () => {
				try {
					const content = await this.doReadFile(provider, resource, options, token);
					resolve(content);
				} catch (error) {
					reject(error);
				}
			}, this.getExtUri(provider).providerExtUri);
		});
	}

	private async doReadFile(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileOptions, token?: CancellationToken): Promise<IFileContent> {
		const stream = await this.doReadFileStream(provider, resource, {
			...options,
			preferUnbuffered: true
		}, token);

		return {
			...stream,
			value: await streamToBuffer(stream.value)
		};
	}

	async readFileStream(resource: URI, options?: IReadFileStreamOptions, token?: CancellationToken): Promise<IFileStreamContent> {
		const provider = await this.withReadProvider(resource);

		return this.doReadFileStream(provider, resource, options, token);
	}

	private async doReadFileStream(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileOptions & IReadFileStreamOptions & { preferUnbuffered?: boolean }, token?: CancellationToken): Promise<IFileStreamContent> {

		const cancellableSource = new CancellationTokenSource(token);

		let readFileOptions = options;
		if (hasFileAtomicReadCapability(provider) && provider.enforceAtomicReadFile?.(resource)) {
			readFileOptions = { ...options, atomic: true };
		}

		const statPromise = this.validateReadFile(resource, readFileOptions).then(stat => stat, error => {
			cancellableSource.dispose(true);

			throw error;
		});

		let fileStream: VSBufferReadableStream | undefined = undefined;
		try {

			if (typeof readFileOptions?.etag === 'string' && readFileOptions.etag !== ETAG_DISABLED) {
				await statPromise;
			}

			if (
				(readFileOptions?.atomic && hasFileAtomicReadCapability(provider)) ||
				!(hasOpenReadWriteCloseCapability(provider) || hasFileReadStreamCapability(provider)) ||
				(hasReadWriteCapability(provider) && readFileOptions?.preferUnbuffered)
			) {
				fileStream = this.readFileUnbuffered(provider, resource, readFileOptions);
			}

			else if (hasFileReadStreamCapability(provider)) {
				fileStream = this.readFileStreamed(provider, resource, cancellableSource.token, readFileOptions);
			}

			else {
				fileStream = this.readFileBuffered(provider, resource, cancellableSource.token, readFileOptions);
			}

			fileStream.on('end', () => cancellableSource.dispose());
			fileStream.on('error', () => cancellableSource.dispose());

			const fileStat = await statPromise;

			return {
				...fileStat,
				value: fileStream
			};
		} catch (error) {

			if (fileStream) {
				await consumeStream(fileStream);
			}

			throw this.restoreReadError(error, resource, readFileOptions);
		}
	}

	private restoreReadError(error: Error, resource: URI, options?: IReadFileStreamOptions): FileOperationError {
		const message = localize('err.read', "Unable to read file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString());

		if (error instanceof NotModifiedSinceFileOperationError) {
			return new NotModifiedSinceFileOperationError(message, error.stat, options);
		}

		if (error instanceof TooLargeFileOperationError) {
			return new TooLargeFileOperationError(message, error.fileOperationResult, error.size, error.options as IReadFileOptions);
		}

		return new FileOperationError(message, toFileOperationResult(error), options);
	}

	private readFileStreamed(provider: IFileSystemProviderWithFileReadStreamCapability, resource: URI, token: CancellationToken, options: IReadFileStreamOptions = Object.create(null)): VSBufferReadableStream {
		const fileStream = provider.readFileStream(resource, options, token);

		return transform(fileStream, {
			data: data => data instanceof VSBuffer ? data : VSBuffer.wrap(data),
			error: error => this.restoreReadError(error, resource, options)
		}, data => VSBuffer.concat(data));
	}

	private readFileBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, token: CancellationToken, options: IReadFileStreamOptions = Object.create(null)): VSBufferReadableStream {
		const stream = newWriteableBufferStream();

		readFileIntoStream(provider, resource, stream, data => data, {
			...options,
			bufferSize: this.BUFFER_SIZE,
			errorTransformer: error => this.restoreReadError(error, resource, options)
		}, token);

		return stream;
	}

	private readFileUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithFileAtomicReadCapability, resource: URI, options?: IReadFileOptions & IReadFileStreamOptions): VSBufferReadableStream {
		const stream = newWriteableStream<VSBuffer>(data => VSBuffer.concat(data));

		(async () => {
			try {
				let buffer: Uint8Array;
				if (options?.atomic && hasFileAtomicReadCapability(provider)) {
					buffer = await provider.readFile(resource, { atomic: true });
				} else {
					buffer = await provider.readFile(resource);
				}

				if (typeof options?.position === 'number') {
					buffer = buffer.slice(options.position);
				}

				if (typeof options?.length === 'number') {
					buffer = buffer.slice(0, options.length);
				}

				this.validateReadFileLimits(resource, buffer.byteLength, options);

				stream.end(VSBuffer.wrap(buffer));
			} catch (err) {
				stream.error(err);
				stream.end();
			}
		})();

		return stream;
	}

	private async validateReadFile(resource: URI, options?: IReadFileStreamOptions): Promise<IFileStatWithMetadata> {
		const stat = await this.resolve(resource, { resolveMetadata: true });

		if (stat.isDirectory) {
			throw new FileOperationError(localize('fileIsDirectoryReadError', "Unable to read file '{0}' that is actually a directory", this.resourceForError(resource)), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		if (typeof options?.etag === 'string' && options.etag !== ETAG_DISABLED && options.etag === stat.etag) {
			throw new NotModifiedSinceFileOperationError(localize('fileNotModifiedError', "File not modified since"), stat, options);
		}

		this.validateReadFileLimits(resource, stat.size, options);

		return stat;
	}

	private validateReadFileLimits(resource: URI, size: number, options?: IReadFileStreamOptions): void {
		if (typeof options?.limits?.size === 'number' && size > options.limits.size) {
			throw new TooLargeFileOperationError(localize('fileTooLargeError', "Unable to read file '{0}' that is too large to open", this.resourceForError(resource)), FileOperationResult.FILE_TOO_LARGE, size, options);
		}
	}



	async canMove(source: URI, target: URI, overwrite?: boolean): Promise<Error | true> {
		return this.doCanMoveCopy(source, target, 'move', overwrite);
	}

	async canCopy(source: URI, target: URI, overwrite?: boolean): Promise<Error | true> {
		return this.doCanMoveCopy(source, target, 'copy', overwrite);
	}

	private async doCanMoveCopy(source: URI, target: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<Error | true> {
		if (source.toString() !== target.toString()) {
			try {
				const sourceProvider = mode === 'move' ? this.throwIfFileSystemIsReadonly(await this.withWriteProvider(source), source) : await this.withReadProvider(source);
				const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

				await this.doValidateMoveCopy(sourceProvider, source, targetProvider, target, mode, overwrite);
			} catch (error) {
				return error;
			}
		}

		return true;
	}

	async move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(source), source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'move', !!overwrite);

		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(source, mode === 'move' ? FileOperation.MOVE : FileOperation.COPY, fileStat));

		return fileStat;
	}

	async copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = await this.withReadProvider(source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', !!overwrite);

		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(source, mode === 'copy' ? FileOperation.COPY : FileOperation.MOVE, fileStat));

		return fileStat;
	}

	private async doMoveCopy(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI, mode: 'move' | 'copy', overwrite: boolean): Promise<'move' | 'copy'> {
		if (source.toString() === target.toString()) {
			return mode;
		}

		const { exists, isSameResourceWithDifferentPathCase } = await this.doValidateMoveCopy(sourceProvider, source, targetProvider, target, mode, overwrite);

		if (exists && !isSameResourceWithDifferentPathCase && overwrite) {
			await this.del(target, { recursive: true });
		}

		await this.mkdirp(targetProvider, this.getExtUri(targetProvider).providerExtUri.dirname(target));

		if (mode === 'copy') {

			if (sourceProvider === targetProvider && hasFileFolderCopyCapability(sourceProvider)) {
				await sourceProvider.copy(source, target, { overwrite });
			}

			else {
				const sourceFile = await this.resolve(source);
				if (sourceFile.isDirectory) {
					await this.doCopyFolder(sourceProvider, sourceFile, targetProvider, target);
				} else {
					await this.doCopyFile(sourceProvider, source, targetProvider, target);
				}
			}

			return mode;
		}

		else {

			if (sourceProvider === targetProvider) {
				await sourceProvider.rename(source, target, { overwrite });

				return mode;
			}

			else {
				await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', overwrite);
				await this.del(source, { recursive: true });

				return 'copy';
			}
		}
	}

	private async doCopyFile(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI): Promise<void> {

		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeBuffered(sourceProvider, source, targetProvider, target);
		}

		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeBufferedToUnbuffered(sourceProvider, source, targetProvider, target);
		}

		if (hasReadWriteCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeUnbufferedToBuffered(sourceProvider, source, targetProvider, target);
		}

		if (hasReadWriteCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeUnbuffered(sourceProvider, source, targetProvider, target);
		}
	}

	private async doCopyFolder(sourceProvider: IFileSystemProvider, sourceFolder: IFileStat, targetProvider: IFileSystemProvider, targetFolder: URI): Promise<void> {

		await targetProvider.mkdir(targetFolder);

		if (Array.isArray(sourceFolder.children)) {
			await Promises.settled(sourceFolder.children.map(async sourceChild => {
				const targetChild = this.getExtUri(targetProvider).providerExtUri.joinPath(targetFolder, sourceChild.name);
				if (sourceChild.isDirectory) {
					return this.doCopyFolder(sourceProvider, await this.resolve(sourceChild.resource), targetProvider, targetChild);
				} else {
					return this.doCopyFile(sourceProvider, sourceChild.resource, targetProvider, targetChild);
				}
			}));
		}
	}

	private async doValidateMoveCopy(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<{ exists: boolean; isSameResourceWithDifferentPathCase: boolean }> {
		let isSameResourceWithDifferentPathCase = false;

		if (sourceProvider === targetProvider) {
			const { providerExtUri, isPathCaseSensitive } = this.getExtUri(sourceProvider);
			if (!isPathCaseSensitive) {
				isSameResourceWithDifferentPathCase = providerExtUri.isEqual(source, target);
			}

			if (isSameResourceWithDifferentPathCase && mode === 'copy') {
				throw new Error(localize('unableToMoveCopyError1', "Unable to copy when source '{0}' is same as target '{1}' with different path case on a case insensitive file system", this.resourceForError(source), this.resourceForError(target)));
			}

			if (!isSameResourceWithDifferentPathCase && providerExtUri.isEqualOrParent(target, source)) {
				throw new Error(localize('unableToMoveCopyError2', "Unable to move/copy when source '{0}' is parent of target '{1}'.", this.resourceForError(source), this.resourceForError(target)));
			}
		}

		const exists = await this.exists(target);
		if (exists && !isSameResourceWithDifferentPathCase) {

			if (!overwrite) {
				throw new FileOperationError(localize('unableToMoveCopyError3', "Unable to move/copy '{0}' because target '{1}' already exists at destination.", this.resourceForError(source), this.resourceForError(target)), FileOperationResult.FILE_MOVE_CONFLICT);
			}

			if (sourceProvider === targetProvider) {
				const { providerExtUri } = this.getExtUri(sourceProvider);
				if (providerExtUri.isEqualOrParent(source, target)) {
					throw new Error(localize('unableToMoveCopyError4', "Unable to move/copy '{0}' into '{1}' since a file would replace the folder it is contained in.", this.resourceForError(source), this.resourceForError(target)));
				}
			}
		}

		return { exists, isSameResourceWithDifferentPathCase };
	}

	private getExtUri(provider: IFileSystemProvider): { providerExtUri: IExtUri; isPathCaseSensitive: boolean } {
		const isPathCaseSensitive = this.isPathCaseSensitive(provider);

		return {
			providerExtUri: isPathCaseSensitive ? extUri : extUriIgnorePathCase,
			isPathCaseSensitive
		};
	}

	private isPathCaseSensitive(provider: IFileSystemProvider): boolean {
		return !!(provider.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);
	}

	async createFolder(resource: URI): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource), resource);

		await this.mkdirp(provider, resource);

		const fileStat = await this.resolve(resource, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	private async mkdirp(provider: IFileSystemProvider, directory: URI): Promise<void> {
		const directoriesToCreate: string[] = [];

		const { providerExtUri } = this.getExtUri(provider);
		while (!providerExtUri.isEqual(directory, providerExtUri.dirname(directory))) {
			try {
				const stat = await provider.stat(directory);
				if ((stat.type & FileType.Directory) === 0) {
					throw new Error(localize('mkdirExistsError', "Unable to create folder '{0}' that already exists but is not a directory", this.resourceForError(directory)));
				}

				break;
			} catch (error) {

				if (toFileSystemProviderErrorCode(error) !== FileSystemProviderErrorCode.FileNotFound) {
					throw error;
				}

				directoriesToCreate.push(providerExtUri.basename(directory));

				directory = providerExtUri.dirname(directory);
			}
		}

		for (let i = directoriesToCreate.length - 1; i >= 0; i--) {
			directory = providerExtUri.joinPath(directory, directoriesToCreate[i]);

			try {
				await provider.mkdir(directory);
			} catch (error) {
				if (toFileSystemProviderErrorCode(error) !== FileSystemProviderErrorCode.FileExists) {
					throw error;
				}
			}
		}
	}

	async canDelete(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<Error | true> {
		try {
			await this.doValidateDelete(resource, options);
		} catch (error) {
			return error;
		}

		return true;
	}

	private async doValidateDelete(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<IFileSystemProvider> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource), resource);

		const useTrash = !!options?.useTrash;
		if (useTrash && !(provider.capabilities & FileSystemProviderCapabilities.Trash)) {
			throw new Error(localize('deleteFailedTrashUnsupported', "Unable to delete file '{0}' via trash because provider does not support it.", this.resourceForError(resource)));
		}

		const atomic = options?.atomic;
		if (atomic && !(provider.capabilities & FileSystemProviderCapabilities.FileAtomicDelete)) {
			throw new Error(localize('deleteFailedAtomicUnsupported', "Unable to delete file '{0}' atomically because provider does not support it.", this.resourceForError(resource)));
		}

		if (useTrash && atomic) {
			throw new Error(localize('deleteFailedTrashAndAtomicUnsupported', "Unable to atomically delete file '{0}' because using trash is enabled.", this.resourceForError(resource)));
		}

		let stat: IStat | undefined = undefined;
		try {
			stat = await provider.stat(resource);
		} catch (error) {
		}

		if (stat) {
			this.throwIfFileIsReadonly(resource, stat);
		} else {
			throw new FileOperationError(localize('deleteFailedNotFound', "Unable to delete nonexistent file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_NOT_FOUND);
		}

		const recursive = !!options?.recursive;
		if (!recursive) {
			const stat = await this.resolve(resource);
			if (stat.isDirectory && Array.isArray(stat.children) && stat.children.length > 0) {
				throw new Error(localize('deleteFailedNonEmptyFolder', "Unable to delete non-empty folder '{0}'.", this.resourceForError(resource)));
			}
		}

		return provider;
	}

	async del(resource: URI, options?: Partial<IFileDeleteOptions>): Promise<void> {
		const provider = await this.doValidateDelete(resource, options);

		let deleteFileOptions = options;
		if (hasFileAtomicDeleteCapability(provider) && !deleteFileOptions?.atomic) {
			const enforcedAtomicDelete = provider.enforceAtomicDelete?.(resource);
			if (enforcedAtomicDelete) {
				deleteFileOptions = { ...options, atomic: enforcedAtomicDelete };
			}
		}

		const useTrash = !!deleteFileOptions?.useTrash;
		const recursive = !!deleteFileOptions?.recursive;
		const atomic = deleteFileOptions?.atomic ?? false;

		await provider.delete(resource, { recursive, useTrash, atomic });

		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.DELETE));
	}



	async cloneFile(source: URI, target: URI): Promise<void> {
		const sourceProvider = await this.withProvider(source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

		if (sourceProvider === targetProvider && this.getExtUri(sourceProvider).providerExtUri.isEqual(source, target)) {
			return;
		}

		if (sourceProvider === targetProvider && hasFileCloneCapability(sourceProvider)) {
			return sourceProvider.cloneFile(source, target);
		}


		await this.mkdirp(targetProvider, this.getExtUri(targetProvider).providerExtUri.dirname(target));

		if (sourceProvider === targetProvider && hasFileFolderCopyCapability(sourceProvider)) {
			return this.writeQueue.queueFor(source, () => sourceProvider.copy(source, target, { overwrite: true }), this.getExtUri(sourceProvider).providerExtUri);
		}

		return this.writeQueue.queueFor(source, () => this.doCopyFile(sourceProvider, source, targetProvider, target), this.getExtUri(sourceProvider).providerExtUri);
	}



	private readonly internalOnDidFilesChange = this._register(new Emitter<FileChangesEvent>());

	private readonly _onDidUncorrelatedFilesChange = this._register(new Emitter<FileChangesEvent>());
	readonly onDidFilesChange = this._onDidUncorrelatedFilesChange.event;

	private readonly _onDidWatchError = this._register(new Emitter<Error>());
	readonly onDidWatchError = this._onDidWatchError.event;

	private readonly activeWatchers = new Map<number , { disposable: IDisposable; count: number }>();

	private static WATCHER_CORRELATION_IDS = 0;

	createWatcher(resource: URI, options: IWatchOptionsWithoutCorrelation & { recursive: false }): IFileSystemWatcher {
		return this.watch(resource, {
			...options,
			correlationId: FileService.WATCHER_CORRELATION_IDS++
		});
	}

	watch(resource: URI, options: IWatchOptionsWithCorrelation): IFileSystemWatcher;
	watch(resource: URI, options?: IWatchOptionsWithoutCorrelation): IDisposable;
	watch(resource: URI, options: IWatchOptions = { recursive: false, excludes: [] }): IFileSystemWatcher | IDisposable {
		const disposables = new DisposableStore();

		let watchDisposed = false;
		let disposeWatch = () => { watchDisposed = true; };
		disposables.add(toDisposable(() => disposeWatch()));

		(async () => {
			try {
				const disposable = await this.doWatch(resource, options);
				if (watchDisposed) {
					dispose(disposable);
				} else {
					disposeWatch = () => dispose(disposable);
				}
			} catch (error) {
				this.logService.error(error);
			}
		})();

		const correlationId = options.correlationId;
		if (typeof correlationId === 'number') {
			const fileChangeEmitter = disposables.add(new Emitter<FileChangesEvent>());
			disposables.add(this.internalOnDidFilesChange.event(e => {
				if (e.correlates(correlationId)) {
					fileChangeEmitter.fire(e);
				}
			}));

			const watcher: IFileSystemWatcher = {
				onDidChange: fileChangeEmitter.event,
				dispose: () => disposables.dispose()
			};

			return watcher;
		}

		return disposables;
	}

	private async doWatch(resource: URI, options: IWatchOptions): Promise<IDisposable> {
		const provider = await this.withProvider(resource);

		const watchHash = hash([this.getExtUri(provider).providerExtUri.getComparisonKey(resource), options]);
		let watcher = this.activeWatchers.get(watchHash);
		if (!watcher) {
			watcher = {
				count: 0,
				disposable: provider.watch(resource, options)
			};

			this.activeWatchers.set(watchHash, watcher);
		}

		watcher.count += 1;

		return toDisposable(() => {
			if (watcher) {

				watcher.count--;

				if (watcher.count === 0) {
					dispose(watcher.disposable);
					this.activeWatchers.delete(watchHash);
				}
			}
		});
	}

	override dispose(): void {
		super.dispose();

		for (const [, watcher] of this.activeWatchers) {
			dispose(watcher.disposable);
		}

		this.activeWatchers.clear();
	}



	private readonly writeQueue = this._register(new ResourceQueue());

	private async doWriteBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, options: IWriteFileOptions | undefined, readableOrStreamOrBufferedStream: VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		return this.writeQueue.queueFor(resource, async () => {

			const handle = await provider.open(resource, { create: true, unlock: options?.unlock ?? false, append: options?.append ?? false });

			try {
				if (isReadableStream(readableOrStreamOrBufferedStream) || isReadableBufferedStream(readableOrStreamOrBufferedStream)) {
					await this.doWriteStreamBufferedQueued(provider, handle, readableOrStreamOrBufferedStream);
				} else {
					await this.doWriteReadableBufferedQueued(provider, handle, readableOrStreamOrBufferedStream);
				}
			} catch (error) {
				throw ensureFileSystemProviderError(error);
			} finally {

				await provider.close(handle);
			}
		}, this.getExtUri(provider).providerExtUri);
	}

	private async doWriteStreamBufferedQueued(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, streamOrBufferedStream: VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		let posInFile = 0;
		let stream: VSBufferReadableStream;

		if (isReadableBufferedStream(streamOrBufferedStream)) {
			if (streamOrBufferedStream.buffer.length > 0) {
				const chunk = VSBuffer.concat(streamOrBufferedStream.buffer);
				await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);

				posInFile += chunk.byteLength;
			}

			if (streamOrBufferedStream.ended) {
				return;
			}

			stream = streamOrBufferedStream.stream;
		}

		else {
			stream = streamOrBufferedStream;
		}

		return new Promise((resolve, reject) => {
			listenStream(stream, {
				onData: async chunk => {

					stream.pause();

					try {
						await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);
					} catch (error) {
						return reject(error);
					}

					posInFile += chunk.byteLength;

					setTimeout(() => stream.resume());
				},
				onError: error => reject(error),
				onEnd: () => resolve()
			});
		});
	}

	private async doWriteReadableBufferedQueued(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, readable: VSBufferReadable): Promise<void> {
		let posInFile = 0;

		let chunk: VSBuffer | null;
		while ((chunk = readable.read()) !== null) {
			await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);

			posInFile += chunk.byteLength;
		}
	}

	private async doWriteBuffer(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, buffer: VSBuffer, length: number, posInFile: number, posInBuffer: number): Promise<void> {
		let totalBytesWritten = 0;
		while (totalBytesWritten < length) {

			const bytesWritten = await provider.write(handle, posInFile + totalBytesWritten, buffer.buffer, posInBuffer + totalBytesWritten, length - totalBytesWritten);
			totalBytesWritten += bytesWritten;
		}
	}

	private async doWriteUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options: IWriteFileOptions | undefined, bufferOrReadableOrStreamOrBufferedStream: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		return this.writeQueue.queueFor(resource, () => this.doWriteUnbufferedQueued(provider, resource, options, bufferOrReadableOrStreamOrBufferedStream), this.getExtUri(provider).providerExtUri);
	}

	private async doWriteUnbufferedQueued(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options: IWriteFileOptions | undefined, bufferOrReadableOrStreamOrBufferedStream: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		let buffer: VSBuffer;
		if (bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer) {
			buffer = bufferOrReadableOrStreamOrBufferedStream;
		} else if (isReadableStream(bufferOrReadableOrStreamOrBufferedStream)) {
			buffer = await streamToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		} else if (isReadableBufferedStream(bufferOrReadableOrStreamOrBufferedStream)) {
			buffer = await bufferedStreamToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		} else {
			buffer = readableToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		}

		await provider.writeFile(resource, buffer.buffer, { create: true, overwrite: true, unlock: options?.unlock ?? false, atomic: options?.atomic ?? false, append: options?.append ?? false });
	}

	private async doPipeBuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, () => this.doPipeBufferedQueued(sourceProvider, source, targetProvider, target), this.getExtUri(targetProvider).providerExtUri);
	}

	private async doPipeBufferedQueued(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		let sourceHandle: number | undefined = undefined;
		let targetHandle: number | undefined = undefined;

		try {

			sourceHandle = await sourceProvider.open(source, { create: false });
			targetHandle = await targetProvider.open(target, { create: true, unlock: false });

			const buffer = VSBuffer.alloc(this.BUFFER_SIZE);

			let posInFile = 0;
			let posInBuffer = 0;
			let bytesRead = 0;
			do {
				bytesRead = await sourceProvider.read(sourceHandle, posInFile, buffer.buffer, posInBuffer, buffer.byteLength - posInBuffer);

				await this.doWriteBuffer(targetProvider, targetHandle, buffer, bytesRead, posInFile, posInBuffer);

				posInFile += bytesRead;
				posInBuffer += bytesRead;

				if (posInBuffer === buffer.byteLength) {
					posInBuffer = 0;
				}
			} while (bytesRead > 0);
		} catch (error) {
			throw ensureFileSystemProviderError(error);
		} finally {
			await Promises.settled([
				typeof sourceHandle === 'number' ? sourceProvider.close(sourceHandle) : Promise.resolve(),
				typeof targetHandle === 'number' ? targetProvider.close(targetHandle) : Promise.resolve(),
			]);
		}
	}

	private async doPipeUnbuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, () => this.doPipeUnbufferedQueued(sourceProvider, source, targetProvider, target), this.getExtUri(targetProvider).providerExtUri);
	}

	private async doPipeUnbufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return targetProvider.writeFile(target, await sourceProvider.readFile(source), { create: true, overwrite: true, unlock: false, atomic: false });
	}

	private async doPipeUnbufferedToBuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, () => this.doPipeUnbufferedToBufferedQueued(sourceProvider, source, targetProvider, target), this.getExtUri(targetProvider).providerExtUri);
	}

	private async doPipeUnbufferedToBufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {

		const targetHandle = await targetProvider.open(target, { create: true, unlock: false });

		try {
			const buffer = await sourceProvider.readFile(source);
			await this.doWriteBuffer(targetProvider, targetHandle, VSBuffer.wrap(buffer), buffer.byteLength, 0, 0);
		} catch (error) {
			throw ensureFileSystemProviderError(error);
		} finally {
			await targetProvider.close(targetHandle);
		}
	}

	private async doPipeBufferedToUnbuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {

		const buffer = await streamToBuffer(this.readFileBuffered(sourceProvider, source, CancellationToken.None));

		await this.doWriteUnbuffered(targetProvider, target, undefined, buffer);
	}

	protected throwIfFileSystemIsReadonly<T extends IFileSystemProvider>(provider: T, resource: URI): T {
		if (provider.capabilities & FileSystemProviderCapabilities.Readonly) {
			throw new FileOperationError(localize('err.readonly', "Unable to modify read-only file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_PERMISSION_DENIED);
		}

		return provider;
	}

	private throwIfFileIsReadonly(resource: URI, stat: IStat): void {
		if ((stat.permissions ?? 0) & FilePermission.Readonly) {
			throw new FileOperationError(localize('err.readonly', "Unable to modify read-only file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_PERMISSION_DENIED);
		}
	}

	private resourceForError(resource: URI): string {
		if (resource.scheme === Schemas.file) {
			return resource.fsPath;
		}

		return resource.toString(true);
	}

}
