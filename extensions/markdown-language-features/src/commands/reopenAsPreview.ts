/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Command } from '../commandManager';

export class ReopenAsPreviewCommand implements Command {
	public readonly id = 'markdown.reopenAsPreview';

	public async execute() {
		await vscode.commands.executeCommand('reopenActiveEditorWith', 'vscode.markdown.preview.editor');
	}
}

export class ReopenAsSourceCommand implements Command {
	public readonly id = 'markdown.reopenAsSource';

	public async execute() {
		await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
	}
}

export class TogglePreviewCommand implements Command {
	public readonly id = 'markdown.togglePreview';

	public async execute() {
		if (vscode.window.activeTextEditor) {
			await vscode.commands.executeCommand('reopenActiveEditorWith', 'vscode.markdown.preview.editor');
		} else {
			await vscode.commands.executeCommand('reopenActiveEditorWith', 'default');
		}
	}
}
