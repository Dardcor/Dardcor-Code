/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatPromptReference {
		readonly value: string | Uri | Location | ChatReferenceBinaryData | unknown;
	}

	export class ChatReferenceBinaryData {
		readonly mimeType: string;

		data(): Thenable<Uint8Array>;

		readonly reference?: Uri;

		readonly isPasted?: boolean;

		readonly isURL?: boolean;

		constructor(mimeType: string, data: () => Thenable<Uint8Array>);
	}
}
