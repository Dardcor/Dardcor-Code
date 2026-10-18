/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface SourceControlActionButton {
		command: Command & { shortTitle?: string };
		secondaryCommands?: Command[][];
		enabled: boolean;
	}

	export interface SourceControl {
		actionButton?: SourceControlActionButton;
	}
}
