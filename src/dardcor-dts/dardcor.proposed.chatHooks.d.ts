/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export type ChatHookType = 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'SubagentStart' | 'SubagentStop' | 'Stop' | 'ErrorOccurred';

	export interface ChatHookCommand {
		readonly command: string;
		readonly cwd?: Uri;
		readonly env?: Record<string, string>;
		readonly timeout?: number;
	}

	export interface ChatRequestHooks {
		readonly [hookType: string]: readonly ChatHookCommand[];
	}

	export type ChatHookResultKind = 'success' | 'error' | 'warning';

	export interface ChatHookResult {
		readonly resultKind: ChatHookResultKind;
		readonly stopReason?: string;
		readonly warningMessage?: string;
		readonly output: unknown;
	}

	export interface ChatRequest {
		readonly hooks?: ChatRequestHooks;
	}

	export class ChatResponseHookPart {
		hookType: ChatHookType;
		stopReason?: string;
		systemMessage?: string;
		metadata?: { readonly [key: string]: unknown };

		constructor(hookType: ChatHookType, stopReason?: string, systemMessage?: string, metadata?: { readonly [key: string]: unknown });
	}

	export interface ExtendedChatResponseParts {
		ChatResponseHookPart: ChatResponseHookPart;
	}

	export interface ChatResponseStream {

		hookProgress(hookType: ChatHookType, stopReason?: string, systemMessage?: string): void;
	}
}
