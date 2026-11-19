/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { canceled } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { newWriteableStream, ReadableStreamEventPayload, ReadableStreamEvents } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IChannel } from '../../../base/parts/ipc/common/ipc.js';
import { createFileSystemProviderError, FileSystemProviderCapabilities, FileSystemProviderErrorCode, FileType, IFileAtomicReadOptions, IFileChange, IFileDeleteOptions, IFileOpenOptions, IFileOverwriteOptions, IFileReadStreamOptions, IFileSystemProviderError, IFileSystemProviderWithFileAtomicReadCapability, IFileSystemProviderWithFileCloneCapability, IFileSystemProviderWithFileFolderCopyCapability, IFileSystemProviderWithFileReadStreamCapability, IFileSystemProviderWithFileReadWriteCapability, IFileSystemProviderWithOpenReadWriteCloseCapability, IFileWriteOptions, IStat, IWatchOptions } from './files.js';
import { reviveFileChanges } from './watcher.js';

export const LOCAL_FILE_SYSTEM_CHANNEL_NAME = 'localFilesystem';

export class DiskFileSystemProviderClient extends Disposable implements
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileReadStreamCapability,
	IFileSystemProviderWithFileFolderCopyCapability,
	IFileSystemProviderWithFileAtomicReadCapability,
	IFileSystemProviderWithFileCloneCapability {

	constructor(
		private readonly channel: IChannel,
		private readonly extraCapabilities: { trash?: boolean; pathCaseSensitive?: boolean }
	) {
		super();

		this.registerFileChangeListeners();
	}


	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private _capabilities: FileSystemProviderCapabilities | undefined;
	get capabilities(): FileSystemProviderCapabilities {
		if (!this._capabilities) {
			this._capabilities =
				FileSystemProviderCapabilities.FileReadWrite |
				FileSystemProviderCapabilities.FileOpenReadWriteClose |
				FileSystemProviderCapabilities.FileReadStream |
				FileSystemProviderCapabilities.FileFolderCopy |
				FileSystemProviderCapabilities.FileWriteUnlock |
				FileSystemProviderCapabilities.FileAtomicRead |
				FileSystemProviderCapabilities.FileAtomicWrite |
				FileSystemProviderCapabilities.FileAtomicDelete |
				FileSystemProviderCapabilities.FileAppend |
				FileSystemProviderCapabilities.FileClone |
				FileSystemProviderCapabilities.FileRealpath;

			if (this.extraCapabilities.pathCaseSensitive) {
				this._capabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
			}

			if (this.extraCapabilities.trash) {
				this._capabilities |= FileSystemProviderCapabilities.Trash;
			}
		}

		return this._capabilities;
	}



	stat(resource: URI): Promise<IStat> {
		return this.channel.call('stat', [resource]);
	}

	realpath(resource: URI): Promise<string> {
		return this.channel.call('realpath', [resource]);
	}

	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.channel.call('readdir', [resource]);
	}



	async readFile(resource: URI, opts?: IFileAtomicReadOptions): Promise<Uint8Array> {
		const { buffer } = await this.channel.call('readFile', [resource, opts]) as VSBuffer;

		return buffer;
	}

	readFileStream(resource: URI, opts: IFileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array> {
		const stream = newWriteableStream<Uint8Array>(data => VSBuffer.concat(data.map(data => VSBuffer.wrap(data))).buffer);
		const disposables = new DisposableStore();

		disposables.add(this.channel.listen<ReadableStreamEventPayload<VSBuffer>>('readFileStream', [resource, opts])(dataOrErrorOrEnd => {

			if (dataOrErrorOrEnd instanceof VSBuffer) {
				stream.write(dataOrErrorOrEnd.buffer);
			}

			else {
				if (dataOrErrorOrEnd === 'end') {
					stream.end();
				} else {
					let error: Error;

					if (dataOrErrorOrEnd instanceof Error) {
						error = dataOrErrorOrEnd;
					}

					else {
						const errorCandidate = dataOrErrorOrEnd as IFileSystemProviderError;

						error = createFileSystemProviderError(errorCandidate.message ?? toErrorMessage(errorCandidate), errorCandidate.code ?? FileSystemProviderErrorCode.Unknown);
					}

					stream.error(error);
					stream.end();
				}

				disposables.dispose();
			}
		}));

		disposables.add(token.onCancellationRequested(() => {

			stream.error(canceled());
			stream.end();

			disposables.dispose();
		}));

		return stream;
	}

	writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		return this.channel.call('writeFile', [resource, VSBuffer.wrap(content), opts]);
	}

	open(resource: URI, opts: IFileOpenOptions): Promise<number> {
		return this.channel.call('open', [resource, opts]);
	}

	close(fd: number): Promise<void> {
		return this.channel.call('close', [fd]);
	}

	async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const [bytes, bytesRead]: [VSBuffer, number] = await this.channel.call('read', [fd, pos, length]);

		data.set(bytes.buffer.slice(0, bytesRead), offset);

		return bytesRead;
	}

	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		return this.channel.call('write', [fd, pos, VSBuffer.wrap(data), offset, length]);
	}



	mkdir(resource: URI): Promise<void> {
		return this.channel.call('mkdir', [resource]);
	}

	delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		return this.channel.call('delete', [resource, opts]);
	}

	rename(resource: URI, target: URI, opts: IFileOverwriteOptions): Promise<void> {
		return this.channel.call('rename', [resource, target, opts]);
	}

	copy(resource: URI, target: URI, opts: IFileOverwriteOptions): Promise<void> {
		return this.channel.call('copy', [resource, target, opts]);
	}



	cloneFile(resource: URI, target: URI): Promise<void> {
		return this.channel.call('cloneFile', [resource, target]);
	}



	private readonly _onDidChange = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChange.event;

	private readonly _onDidWatchError = this._register(new Emitter<string>());
	readonly onDidWatchError = this._onDidWatchError.event;

	private readonly sessionId = generateUuid();

	private registerFileChangeListeners(): void {

		this._register(this.channel.listen<IFileChange[] | string>('fileChange', [this.sessionId])(eventsOrError => {
			if (Array.isArray(eventsOrError)) {
				const events = eventsOrError;
				this._onDidChange.fire(reviveFileChanges(events));
			} else {
				const error = eventsOrError;
				this._onDidWatchError.fire(error);
			}
		}));
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {

		const req = generateUuid();

		this.channel.call('watch', [this.sessionId, req, resource, opts]);

		return toDisposable(() => this.channel.call('unwatch', [this.sessionId, req]));
	}

}
