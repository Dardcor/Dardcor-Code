/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export enum LanguageModelPartAudience {
		Assistant = 0,
		User = 1,
		Extension = 2,
	}

	export class LanguageModelTextPart2 extends LanguageModelTextPart {
		audience: LanguageModelPartAudience[] | undefined;
		constructor(value: string, audience?: LanguageModelPartAudience[]);
	}

	export class LanguageModelDataPart2 extends LanguageModelDataPart {
		audience: LanguageModelPartAudience[] | undefined;
		constructor(data: Uint8Array, mimeType: string, audience?: LanguageModelPartAudience[]);
	}
}
