/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../../../util/common/services';

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export interface FileStat {
	ctime: number;


	mtime: number;
	size: number;
	type: FileType;
}

export type FileIdentifier = string | { readonly uri: string };

export const ICompletionsFileSystemService = createServiceIdentifier<ICompletionsFileSystemService>('ICompletionsFileSystemService');
export interface ICompletionsFileSystemService {
	readonly _serviceBrand: undefined;

	readFileString(uri: FileIdentifier): Promise<string>;
	stat(uri: FileIdentifier): Promise<FileStat>;
	readDirectory(uri: FileIdentifier): Promise<[string, FileType][]>;
}
