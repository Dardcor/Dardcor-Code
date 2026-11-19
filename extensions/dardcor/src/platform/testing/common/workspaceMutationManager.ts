/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { CancellationToken } from '../../../util/dardcor/base/common/cancellation';
import { URI } from '../../../util/dardcor/base/common/uri';

export interface IWorkspaceMutationOptions {
	query: string;
	fileTree: string;
	baseURI: URI;
	files: string[];
}

export interface IWorkspaceMutation {
	get(file: string, token: CancellationToken): Promise<string>;

	apply(progress: undefined | vscode.Progress<{ message: string }>, token: vscode.CancellationToken): Promise<void>;
}

export interface IWorkspaceMutationManager {
	_serviceBrand: undefined;

	create(requestId: string, options: IWorkspaceMutationOptions): IWorkspaceMutation;
	get(requestId: string): IWorkspaceMutation;
}

export const IWorkspaceMutationManager = createServiceIdentifier<IWorkspaceMutationManager>('IWorkspaceMutationManager');
