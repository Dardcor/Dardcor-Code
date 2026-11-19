/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export class NotebookRendererScript {

		provides: readonly string[];

		uri: Uri;

		constructor(uri: Uri, provides?: string | readonly string[]);
	}

	export interface NotebookController {

		readonly rendererScripts: NotebookRendererScript[];

		readonly onDidReceiveMessage: Event<{ readonly editor: NotebookEditor; readonly message: any }>;

		postMessage(message: any, editor?: NotebookEditor): Thenable<boolean>;

		asWebviewUri(localResource: Uri): Uri;
	}

	export namespace notebooks {

		export function createNotebookController(id: string, viewType: string, label: string, handler?: (cells: NotebookCell[], notebook: NotebookDocument, controller: NotebookController) => void | Thenable<void>, rendererScripts?: NotebookRendererScript[]): NotebookController;
	}
}
