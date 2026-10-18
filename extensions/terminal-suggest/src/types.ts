/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface ICompletionResource {
	label: string | vscode.CompletionItemLabel;
	definitionCommand?: string;
	documentation?: string | vscode.MarkdownString;
	detail?: string;
	kind?: vscode.TerminalCompletionItemKind;
}
