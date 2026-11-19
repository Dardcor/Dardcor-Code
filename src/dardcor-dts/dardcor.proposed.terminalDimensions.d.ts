/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TerminalDimensionsChangeEvent {
		readonly terminal: Terminal;
		readonly dimensions: TerminalDimensions;
	}

	export namespace window {
		export const onDidChangeTerminalDimensions: Event<TerminalDimensionsChangeEvent>;
	}

	export interface Terminal {
		readonly dimensions: TerminalDimensions | undefined;
	}
}
