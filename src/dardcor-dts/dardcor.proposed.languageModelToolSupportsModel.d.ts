/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface LanguageModelToolDefinition extends LanguageModelToolInformation {
		displayName: string;
		toolReferenceName?: string;
		userDescription?: string;
		icon?: IconPath;
		models?: LanguageModelChatSelector[];
		toolSet?: string;
	}

	export namespace lm {
		export function registerToolDefinition<T>(
			definition: LanguageModelToolDefinition,
			tool: LanguageModelTool<T>,
		): Disposable;

		export function invokeTool(tool: LanguageModelToolInformation, options: LanguageModelToolInvocationOptions<object>, token?: CancellationToken): Thenable<LanguageModelToolResult>;
	}
}
