/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';

export const IClaudeWorkspaceFolderService = createServiceIdentifier<IClaudeWorkspaceFolderService>('IClaudeWorkspaceFolderService');

export interface IClaudeWorkspaceFolderService {
	readonly _serviceBrand: undefined;
	getWorkspaceChanges(cwd: string, gitBranch: string | undefined, gitBaseBranch: string | undefined, forceRefresh?: boolean): Promise<vscode.ChatSessionChangedFile[]>;
}
