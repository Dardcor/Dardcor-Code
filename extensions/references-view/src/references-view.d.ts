/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface SymbolTree {

	setInput(input: SymbolTreeInput<unknown>): void;

	getInput(): SymbolTreeInput<unknown> | undefined;
}

export interface SymbolTreeInput<T> {

	readonly contextValue: string;

	readonly title: string;

	readonly location: vscode.Location;

	resolve(): vscode.ProviderResult<SymbolTreeModel<T>>;

	with(location: vscode.Location): SymbolTreeInput<T>;
}

export interface SymbolTreeModel<T> {

	provider: vscode.TreeDataProvider<T>;

	message: string | undefined;

	navigation?: SymbolItemNavigation<T>;

	highlights?: SymbolItemEditorHighlights<T>;

	dnd?: SymbolItemDragAndDrop<T>;

	dispose?(): void;
}

export interface SymbolItemNavigation<T> {
	nearest(uri: vscode.Uri, position: vscode.Position): T | undefined;
	next(from: T): T;
	previous(from: T): T;
	location(item: T): vscode.Location | undefined;
}

export interface SymbolItemEditorHighlights<T> {
	getEditorHighlights(item: T, uri: vscode.Uri): vscode.Range[] | undefined;
}

export interface SymbolItemDragAndDrop<T> {

	getDragUri(item: T): vscode.Uri | undefined;
}
