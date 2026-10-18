/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export enum SourceControlInputBoxValidationType {

		Error = 0,

		Warning = 1,

		Information = 2
	}

	export interface SourceControlInputBoxValidation {

		readonly message: string | MarkdownString;

		readonly type: SourceControlInputBoxValidationType;
	}

	export interface SourceControlInputBox {

		showValidationMessage(message: string | MarkdownString, type: SourceControlInputBoxValidationType): void;

		validateInput?(value: string, cursorPosition: number): ProviderResult<SourceControlInputBoxValidation>;
	}
}
