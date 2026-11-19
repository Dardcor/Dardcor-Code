/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TreeView<T> extends Disposable {
		readonly activeItem: T | undefined;
		readonly onDidChangeActiveItem: Event<TreeViewActiveItemChangeEvent<T>>;
	}

	export interface TreeViewActiveItemChangeEvent<T> {
		readonly activeItem: T | undefined;
	}
}
