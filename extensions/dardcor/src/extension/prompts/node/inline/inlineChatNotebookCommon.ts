/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface NotebookPromptPriority {
	core?: number;
	context?: number;
	runtimeCore?: number;
	history?: number;
	other?: number;
}

export const promptPriorities: NotebookPromptPriority = {
	core: 1000,
	context: 800,
	runtimeCore: 600,
	history: 500,
	other: 100
};
