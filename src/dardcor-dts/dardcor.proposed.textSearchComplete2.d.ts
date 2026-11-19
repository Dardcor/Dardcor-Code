/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface TextSearchComplete2 {
		message?: TextSearchCompleteMessage2[];
	}

	export interface TextSearchCompleteMessage2 {
		text: string;
		trusted?: boolean;
		type: TextSearchCompleteMessageType;
	}
}
