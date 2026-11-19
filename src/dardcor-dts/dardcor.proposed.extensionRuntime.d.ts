/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum ExtensionRuntime {
		Node = 1,
		Webworker = 2
	}

	export interface ExtensionContext {
		readonly extensionRuntime: ExtensionRuntime;
	}
}
