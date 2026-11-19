/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileDeleteOptions, IFileOverwriteOptions, FileSystemProviderCapabilities, FileType, IFileWriteOptions, hasReadWriteCapability, IFileService, IFileSystemProvider, IFileSystemProviderWithFileReadWriteCapability, IStat, IWatchOptions } from '../../../../platform/files/common/files.js';
import { isEqual } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

interface ILocalHistoryResource {

	readonly location: URI;

	readonly associatedResource: URI;
}

interface ISerializedLocalHistoryResource {
	readonly location: string;
	readonly associatedResource: string;
}

export class LocalHistoryFileSystemProvider implements IFileSystemProvider, IFileSystemProviderWithFileReadWriteCapability {

	static readonly SCHEMA = 'vscode-local-history';

	static toLocalHistoryFileSystem(resource: ILocalHistoryResource): URI {
		const serializedLocalHistoryResource: ISerializedLocalHistoryResource = {
			location: resource.location.toString(true),
			associatedResource: resource.associatedResource.toString(true)
		};

		return resource.associatedResource.with({
			scheme: LocalHistoryFileSystemProvider.SCHEMA,
			query: JSON.stringify(serializedLocalHistoryResource)
		});
	}

	static fromLocalHistoryFileSystem(resource: URI): ILocalHistoryResource {
		const serializedLocalHistoryResource: ISerializedLocalHistoryResource = JSON.parse(resource.query);

		return {
			location: URI.parse(serializedLocalHistoryResource.location),
			associatedResource: URI.parse(serializedLocalHistoryResource.associatedResource)
		};
	}

	private static readonly EMPTY_RESOURCE = URI.from({ scheme: LocalHistoryFileSystemProvider.SCHEMA, path: '/empty' });

	static readonly EMPTY: ILocalHistoryResource = {
		location: LocalHistoryFileSystemProvider.EMPTY_RESOURCE,
		associatedResource: LocalHistoryFileSystemProvider.EMPTY_RESOURCE
	};

	get capabilities() {
		return FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.Readonly;
	}

	constructor(private readonly fileService: IFileService) { }

	private readonly mapSchemeToProvider = new Map<string, Promise<IFileSystemProvider>>();

	private async withProvider(resource: URI): Promise<IFileSystemProvider> {
		const scheme = resource.scheme;

		let providerPromise = this.mapSchemeToProvider.get(scheme);
		if (!providerPromise) {

			const provider = this.fileService.getProvider(scheme);
			if (provider) {
				providerPromise = Promise.resolve(provider);
			}

			else {
				providerPromise = new Promise<IFileSystemProvider>(resolve => {
					const disposable = this.fileService.onDidChangeFileSystemProviderRegistrations(e => {
						if (e.added && e.provider && e.scheme === scheme) {
							disposable.dispose();

							resolve(e.provider);
						}
					});
				});
			}

			this.mapSchemeToProvider.set(scheme, providerPromise);
		}

		return providerPromise;
	}


	async stat(resource: URI): Promise<IStat> {
		const location = LocalHistoryFileSystemProvider.fromLocalHistoryFileSystem(resource).location;

		if (isEqual(LocalHistoryFileSystemProvider.EMPTY_RESOURCE, location)) {
			return { type: FileType.File, ctime: 0, mtime: 0, size: 0 };
		}

		return (await this.withProvider(location)).stat(location);
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const location = LocalHistoryFileSystemProvider.fromLocalHistoryFileSystem(resource).location;

		if (isEqual(LocalHistoryFileSystemProvider.EMPTY_RESOURCE, location)) {
			return VSBuffer.fromString('').buffer;
		}

		const provider = await this.withProvider(location);
		if (hasReadWriteCapability(provider)) {
			return provider.readFile(location);
		}

		throw new Error('Unsupported');
	}



	readonly onDidChangeCapabilities = Event.None;
	readonly onDidChangeFile = Event.None;

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> { }

	async mkdir(resource: URI): Promise<void> { }
	async readdir(resource: URI): Promise<[string, FileType][]> { return []; }

	async rename(from: URI, to: URI, opts: IFileOverwriteOptions): Promise<void> { }
	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> { }

	watch(resource: URI, opts: IWatchOptions): IDisposable { return Disposable.None; }

}
