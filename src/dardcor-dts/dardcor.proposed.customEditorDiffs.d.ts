/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface CustomEditorDiffDocuments<T> {
		readonly original: T;

		readonly modified: T;
	}

	export interface CustomEditorSideBySideDiffWebviewPanels {
		readonly original: WebviewPanel;

		readonly modified: WebviewPanel;
	}

	export interface CustomReadonlyEditorProvider<T extends CustomDocument = CustomDocument> {

		resolveCustomEditorInlineDiff?(documents: CustomEditorDiffDocuments<T>, webviewPanel: WebviewPanel, token: CancellationToken): Thenable<void> | void;

		resolveCustomEditorSideBySideDiff?(documents: CustomEditorDiffDocuments<T>, webviewPanels: CustomEditorSideBySideDiffWebviewPanels, token: CancellationToken): Thenable<void> | void;
	}

	export interface CustomTextEditorProvider {

		resolveCustomTextEditorInlineDiff?(documents: CustomEditorDiffDocuments<TextDocument>, webviewPanel: WebviewPanel, token: CancellationToken): Thenable<void> | void;

		resolveCustomTextEditorSideBySideDiff?(documents: CustomEditorDiffDocuments<TextDocument>, webviewPanels: CustomEditorSideBySideDiffWebviewPanels, token: CancellationToken): Thenable<void> | void;
	}
}
