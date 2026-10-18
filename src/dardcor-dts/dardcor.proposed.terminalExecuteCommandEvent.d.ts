/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface TerminalExecutedCommand {
		terminal: Terminal;
		commandLine: string | undefined;
		cwd: Uri | string | undefined;
		exitCode: number | undefined;
		output: string | undefined;
	}

	export namespace window {
		export const onDidExecuteTerminalCommand: Event<TerminalExecutedCommand>;
	}
}
