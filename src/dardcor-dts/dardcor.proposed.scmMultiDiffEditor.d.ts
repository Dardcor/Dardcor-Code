/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface SourceControlResourceState {
		readonly multiDiffEditorOriginalUri?: Uri;

		readonly multiFileDiffEditorModifiedUri?: Uri;
	}

	export interface SourceControl {
		createResourceGroup(id: string, label: string, options: { multiDiffEditorEnableViewChanges?: boolean }): SourceControlResourceGroup;
	}
}
