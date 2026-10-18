/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ToolProgressStep {
		message?: string | MarkdownString;
		increment?: number;
	}

	export interface LanguageModelTool<T> {
		invoke(options: LanguageModelToolInvocationOptions<T>, token: CancellationToken, progress: Progress<ToolProgressStep>): ProviderResult<LanguageModelToolResult>;
	}
}
