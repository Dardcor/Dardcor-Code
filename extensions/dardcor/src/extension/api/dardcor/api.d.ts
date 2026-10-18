/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextEditor } from 'vscode';

export interface CopilotExtensionApi {
	selectScope: (editor?: TextEditor, options?: { reason?: string }) => Promise<Selection | undefined>;
}
