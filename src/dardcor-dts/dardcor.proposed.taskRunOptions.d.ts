/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export enum TaskRunOn {
		Default = 1,

		FolderOpen = 2,

		WorktreeCreated = 3,
	}

	export interface RunOptions {
		runOn?: TaskRunOn;
	}
}