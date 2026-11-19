/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri, workspace, Disposable } from 'vscode';
import { RequestType, BaseLanguageClient } from 'vscode-languageclient';
import { Runtime } from './htmlClient';

export namespace FsStatRequest {
	export const type: RequestType<string, FileStat, any> = new RequestType('fs/stat');
}

export namespace FsReadDirRequest {
	export const type: RequestType<string, [string, FileType][], any> = new RequestType('fs/readDir');
}

export function serveFileSystemRequests(client: BaseLanguageClient, runtime: Runtime): Disposable {
	const disposables = [];
	disposables.push(client.onRequest(FsReadDirRequest.type, (uriString: string) => {
		const uri = Uri.parse(uriString);
		if (uri.scheme === 'file' && runtime.fileFs) {
			return runtime.fileFs.readDirectory(uriString);
		}
		return workspace.fs.readDirectory(uri);
	}));
	disposables.push(client.onRequest(FsStatRequest.type, (uriString: string) => {
		const uri = Uri.parse(uriString);
		if (uri.scheme === 'file' && runtime.fileFs) {
			return runtime.fileFs.stat(uriString);
		}
		return workspace.fs.stat(uri);
	}));
	return Disposable.from(...disposables);
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}
export interface FileStat {
	type: FileType;
	ctime: number;
	mtime: number;
	size: number;
}

export interface FileSystemProvider {
	stat(uri: string): Promise<FileStat>;
	readDirectory(uri: string): Promise<[string, FileType][]>;
}
