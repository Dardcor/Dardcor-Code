/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface DocumentSelector {
	readonly syntax: readonly vscode.DocumentFilter[];

	readonly semantic: readonly vscode.DocumentFilter[];
}
