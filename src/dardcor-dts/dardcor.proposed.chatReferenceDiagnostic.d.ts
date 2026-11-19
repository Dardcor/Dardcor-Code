/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatPromptReference {
		readonly value: string | Uri | Location | ChatReferenceDiagnostic | unknown;
	}

	export class ChatReferenceDiagnostic {
		readonly diagnostics: [Uri, Diagnostic[]][];

		constructor(diagnostics: [Uri, Diagnostic[]][]);
	}
}
