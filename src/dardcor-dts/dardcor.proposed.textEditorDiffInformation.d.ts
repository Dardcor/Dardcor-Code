/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export enum TextEditorChangeKind {
		Addition = 1,
		Deletion = 2,
		Modification = 3
	}

	export interface TextEditorLineRange {
		readonly startLineNumber: number;
		readonly endLineNumberExclusive: number;
	}

	export interface TextEditorChange {
		readonly original: TextEditorLineRange;
		readonly modified: TextEditorLineRange;
		readonly kind: TextEditorChangeKind;
	}

	export interface TextEditorDiffInformation {
		readonly documentVersion: number;
		readonly original: Uri | undefined;
		readonly modified: Uri;
		readonly changes: readonly TextEditorChange[];
		readonly isStale: boolean;
	}

	export interface TextEditorDiffInformationChangeEvent {
		readonly textEditor: TextEditor;
		readonly diffInformation: TextEditorDiffInformation[] | undefined;
	}

	export interface TextEditor {
		readonly diffInformation: TextEditorDiffInformation[] | undefined;
	}

	export interface SourceControlDiffInformationProvider extends Disposable {
		readonly diffInformation: TextEditorDiffInformation | undefined;

		readonly onDidChange: Event<void>;
	}

	export namespace window {
		export const onDidChangeTextEditorDiffInformation: Event<TextEditorDiffInformationChangeEvent>;

		export function createSourceControlDiffInformation(uri: Uri): SourceControlDiffInformationProvider;
	}

}
