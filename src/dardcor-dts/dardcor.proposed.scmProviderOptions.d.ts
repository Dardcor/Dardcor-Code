/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface SourceControl {
		contextValue?: string;

		readonly onDidDisposeParent: Event<void>;
	}

	export namespace scm {
		export function createSourceControl(id: string, label: string, rootUri?: Uri, iconPath?: IconPath, isHidden?: boolean, parent?: SourceControl): SourceControl;
	}
}
