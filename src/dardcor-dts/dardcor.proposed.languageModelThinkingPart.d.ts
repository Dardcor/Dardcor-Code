/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export class LanguageModelThinkingPart {
		value: string | string[];

		id?: string;

		metadata?: { readonly [key: string]: any };

		constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any });
	}

	export interface LanguageModelChatResponse {
		stream: AsyncIterable<LanguageModelTextPart | LanguageModelThinkingPart | LanguageModelToolCallPart | unknown>;
	}

	export interface LanguageModelChat {
		sendRequest(messages: Array<LanguageModelChatMessage | LanguageModelChatMessage2>, options?: LanguageModelChatRequestOptions, token?: CancellationToken): Thenable<LanguageModelChatResponse>;
		countTokens(text: string | LanguageModelChatMessage | LanguageModelChatMessage2, token?: CancellationToken): Thenable<number>;
	}

	export class LanguageModelChatMessage2 {

		static User(content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelDataPart>, name?: string): LanguageModelChatMessage2;

		static Assistant(content: string | Array<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>, name?: string): LanguageModelChatMessage2;

		role: LanguageModelChatMessageRole;

		content: Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart | LanguageModelDataPart | LanguageModelThinkingPart>;

		name: string | undefined;

		constructor(role: LanguageModelChatMessageRole, content: string | Array<LanguageModelTextPart | LanguageModelToolResultPart | LanguageModelToolCallPart | LanguageModelDataPart | LanguageModelThinkingPart>, name?: string);
	}

	export class LanguageModelToolResultPart2 extends LanguageModelToolResultPart { }

	export class LanguageModelToolResult2 extends LanguageModelToolResult { }
}
