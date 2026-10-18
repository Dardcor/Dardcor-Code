/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {
	export namespace debug {
		export function registerDebugVisualizationProvider<T extends DebugVisualization>(
			id: string,
			provider: DebugVisualizationProvider<T>
		): Disposable;

		export function registerDebugVisualizationTreeProvider<T extends DebugTreeItem>(
			id: string,
			provider: DebugVisualizationTree<T>
		): Disposable;
	}

	export interface DebugTreeItem {
		label: string;

		description?: string;

		collapsibleState?: TreeItemCollapsibleState;

		contextValue?: string;

		canEdit?: boolean;
	}

	export interface DebugVisualizationTree<T extends DebugTreeItem = DebugTreeItem> {
		getTreeItem(context: DebugVisualizationContext): ProviderResult<T>;
		getChildren(element: T): ProviderResult<T[]>;
		editItem?(item: T, value: string): ProviderResult<T>;
	}

	export class DebugVisualization {
		name: string;

		iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;

		visualization?: Command | { treeId: string };

		constructor(name: string);
	}

	export interface DebugVisualizationProvider<T extends DebugVisualization = DebugVisualization> {
		provideDebugVisualization(context: DebugVisualizationContext, token: CancellationToken): ProviderResult<T[]>;

		resolveDebugVisualization?(visualization: T, token: CancellationToken): ProviderResult<T>;
	}

	export interface DebugVisualizationContext {
		variable: any;
		containerId?: number;
		frameId?: number;
		threadId: number;
		session: DebugSession;
	}
}
