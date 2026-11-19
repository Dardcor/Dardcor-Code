/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI } from '../../../util/dardcor/base/common/uri';

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export class RelativePattern implements vscode.RelativePattern {
	constructor(
		public readonly baseUri: URI,
		public readonly pattern: string,
	) { }

	get base(): string { throw new Error('Not implemented'); }
}
