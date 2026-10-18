/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface TextDocumentDetailedChangeReason {
		readonly source: string;

		readonly metadata: { readonly [key: string]: any };
	}

	export interface TextDocumentChangeEvent {
		readonly detailedReason: TextDocumentDetailedChangeReason | undefined;
	}
}
