/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {



	export enum NotebookDocumentSaveReason {





		Manual = 1,




		AfterDelay = 2,




		FocusOut = 3
	}








	export interface NotebookDocumentWillSaveEvent {



		readonly token: CancellationToken;




		readonly document: NotebookDocument;




		readonly reason: NotebookDocumentSaveReason;





		waitUntil(thenable: Thenable<readonly WorkspaceEdit[]>): void;

		waitUntil(thenable: Thenable<any>): void;
	}

	export namespace workspace {

		export const onWillSaveNotebookDocument: Event<NotebookDocumentWillSaveEvent>;
	}
}
