/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface SourceControl {

		readonly selected: boolean;

		readonly onDidChangeSelection: Event<boolean>;
	}
}
