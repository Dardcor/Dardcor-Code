/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface TerminalShellIntegrationEnvironment {
		value: { [key: string]: string | undefined };

		isTrusted: boolean;
	}

	export interface TerminalShellIntegration {
		readonly env: TerminalShellIntegrationEnvironment | undefined;
	}

}
