/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import { FileSystemProviderCapabilities, FileType, IFileService, IFileSystemProviderWithFileRealpathCapability, IStat } from '../../../../../../../platform/files/common/files.js';
import { dirname } from '../../../../../../../base/common/resources.js';
import { InMemoryFileSystemProvider } from '../../../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { ResourceMap } from '../../../../../../../base/common/map.js';

export class TestInMemoryFileSystemProviderWithRealPath extends InMemoryFileSystemProvider implements IFileSystemProviderWithFileRealpathCapability {
	private readonly realPathMappings = new ResourceMap<URI>();

	override get capabilities(): FileSystemProviderCapabilities {
		return super.capabilities | FileSystemProviderCapabilities.FileRealpath;
	}

	setRealPath(uri: URI, realPath: URI): void {
		this.realPathMappings.set(uri, realPath);
	}

	clearRealPathMappings(): void {
		this.realPathMappings.clear();
	}

	async realpath(resource: URI): Promise<string> {
		const mapped = this.realPathMappings.get(resource);
		if (mapped) {
			return mapped.path;
		}
		return resource.path;
	}

	override async stat(resource: URI): Promise<IStat> {
		const baseStat = await super.stat(resource);
		const isSymlink = this.realPathMappings.has(resource);
		if (isSymlink) {
			return {
				...baseStat,
				type: baseStat.type | FileType.SymbolicLink
			};
		}
		return baseStat;
	}

	override async readdir(resource: URI): Promise<[string, FileType][]> {
		const entries = await super.readdir(resource);
		return entries.map(([name, type]) => {
			const childUri = URI.joinPath(resource, name);
			if (this.realPathMappings.has(childUri)) {
				return [name, type | FileType.SymbolicLink];
			}
			return [name, type];
		});
	}
}

interface IMockFilesystemNode {
	name: string;
}

export interface IMockFile extends IMockFilesystemNode {
	contents: string | readonly string[];
}

export interface IMockFolder extends IMockFilesystemNode {
	children: (IMockFolder | IMockFile)[];
}


export interface IMockFileEntry {
	path: string;
	contents: string[];
}

export function mockFiles(fileService: IFileService, files: IMockFileEntry[], parentFolder?: URI): Promise<void> {
	return new MockFilesystem(files, fileService).mock(parentFolder);
}

export class MockFilesystem {

	private createdFiles: URI[] = [];
	private createdFolders: URI[] = [];
	private createdRootFolders: URI[] = [];

	constructor(
		private readonly input: IMockFolder[] | IMockFileEntry[],
		@IFileService private readonly fileService: IFileService,
	) { }



	public async mock(parentFolder?: URI): Promise<void> {
		if (this.input.length > 0 && 'path' in this.input[0]) {
			return this.mockFromFileEntries(this.input as IMockFileEntry[]);
		}

		return this.mockFromFolders(this.input as IMockFolder[], parentFolder);
	}

	private async mockFromFileEntries(fileEntries: IMockFileEntry[]): Promise<void> {
		for (const fileEntry of fileEntries) {
			const fileUri = URI.file(fileEntry.path);

			await this.ensureParentDirectories(dirname(fileUri));

			const contents = fileEntry.contents.join('\n');
			await this.fileService.writeFile(fileUri, VSBuffer.fromString(contents));

			this.createdFiles.push(fileUri);
		}
	}

	private async mockFromFolders(folders: IMockFolder[], parentFolder?: URI): Promise<void> {
		const result = await Promise.all(folders.map((folder) => this.mockFolder(folder, parentFolder)));
		this.createdRootFolders.push(...result);
	}

	public async delete(): Promise<void> {
		for (const fileUri of this.createdFiles) {
			if (await this.fileService.exists(fileUri)) {
				await this.fileService.del(fileUri, { useTrash: false });
			}
		}

		for (const folderUri of this.createdFolders.reverse()) {
			if (await this.fileService.exists(folderUri)) {
				await this.fileService.del(folderUri, { recursive: true, useTrash: false });
			}
		}

		for (const folder of this.createdRootFolders) {
			await this.fileService.del(folder, { recursive: true, useTrash: false });
		}
	}

	private async mockFolder(folder: IMockFolder, parentFolder?: URI): Promise<URI> {
		const folderUri = parentFolder
			? URI.joinPath(parentFolder, folder.name)
			: URI.file(folder.name);

		if (!(await this.fileService.exists(folderUri))) {
			try {
				await this.fileService.createFolder(folderUri);
			} catch (error) {
				throw new Error(`Failed to create folder '${folderUri.fsPath}': ${error}.`);
			}
		}

		const resolvedChildren: URI[] = [];
		for (const child of folder.children) {
			const childUri = URI.joinPath(folderUri, child.name);
			if ('contents' in child) {
				const contents: string = (typeof child.contents === 'string')
					? child.contents
					: child.contents.join('\n');

				await this.fileService.writeFile(childUri, VSBuffer.fromString(contents));

				resolvedChildren.push(childUri);

				continue;
			}

			resolvedChildren.push(await this.mockFolder(child, folderUri));
		}

		return folderUri;
	}

	private async ensureParentDirectories(dirUri: URI): Promise<void> {
		if (!await this.fileService.exists(dirUri)) {
			if (dirUri.path !== '/') {
				await this.ensureParentDirectories(dirname(dirUri));
			}
			try {
				await this.fileService.createFolder(dirUri);
				this.createdFolders.push(dirUri);
			} catch (error) {
				throw new Error(`Failed to create directory '${dirUri.toString()}': ${error}.`);
			}
		}
	}
}
