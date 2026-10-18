/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface LanguageModelChat {
		readonly capabilities: {
			readonly supportsToolCalling: boolean;
			readonly supportsImageToText: boolean;

			readonly editToolsHint?: readonly string[];
		};
	}
}
