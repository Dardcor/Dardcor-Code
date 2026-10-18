/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export class TabInputInteractiveWindow {
		readonly uri: Uri;
		readonly inputBoxUri: Uri;
		private constructor(uri: Uri, inputBoxUri: Uri);
	}

	export interface Tab {
		readonly input: TabInputText | TabInputTextDiff | TabInputCustom | TabInputWebview | TabInputNotebook | TabInputNotebookDiff | TabInputTerminal | TabInputInteractiveWindow | unknown;
	}
}
