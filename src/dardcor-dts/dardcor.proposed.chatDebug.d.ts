/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export enum ChatDebugLogLevel {
		Trace = 0,
		Info = 1,
		Warning = 2,
		Error = 3
	}

	export enum ChatDebugToolCallResult {
		Success = 0,
		Error = 1
	}

	export class ChatDebugToolCallEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		toolName: string;

		toolCallId?: string;

		input?: string;

		output?: string;

		result?: ChatDebugToolCallResult;

		durationInMillis?: number;

		constructor(toolName: string, created: Date);
	}

	export class ChatDebugModelTurnEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		model?: string;

		inputTokens?: number;

		outputTokens?: number;

		totalTokens?: number;

		durationInMillis?: number;

		cachedTokens?: number;

		timeToFirstTokenInMillis?: number;

		requestId?: string;

		maxInputTokens?: number;

		maxOutputTokens?: number;

		requestName?: string;

		requestOptions?: string;

		status?: string;

		copilotUsageNanoAiu?: number;

		dardcorUsageNanoAiu?: number;

		constructor(created: Date);
	}

	export class ChatDebugGenericEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		name: string;

		details?: string;

		level: ChatDebugLogLevel;

		category?: string;

		constructor(name: string, level: ChatDebugLogLevel, created: Date);
	}

	export enum ChatDebugSubagentStatus {
		Running = 0,
		Completed = 1,
		Failed = 2
	}

	export class ChatDebugSubagentInvocationEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		agentName: string;

		description?: string;

		status?: ChatDebugSubagentStatus;

		durationInMillis?: number;

		toolCallCount?: number;

		modelTurnCount?: number;

		constructor(agentName: string, created: Date);
	}

	export class ChatDebugUserMessageEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		message: string;

		sections: ChatDebugMessageSection[];

		constructor(message: string, created: Date);
	}

	export class ChatDebugAgentResponseEvent {
		id?: string;

		sessionResource?: Uri;

		created: Date;

		parentEventId?: string;

		message: string;

		sections: ChatDebugMessageSection[];

		constructor(message: string, created: Date);
	}

	export class ChatDebugMessageSection {
		name: string;

		content: string;

		constructor(name: string, content: string);
	}

	export class ChatDebugEventTextContent {
		value: string;

		constructor(value: string);
	}

	export enum ChatDebugMessageContentType {
		User = 0,
		Agent = 1
	}

	export class ChatDebugEventMessageContent {
		type: ChatDebugMessageContentType;

		message: string;

		sections: ChatDebugMessageSection[];

		constructor(type: ChatDebugMessageContentType, message: string, sections: ChatDebugMessageSection[]);
	}

	export class ChatDebugEventToolCallContent {
		toolName: string;

		result?: ChatDebugToolCallResult;

		durationInMillis?: number;

		input?: string;

		output?: string;

		constructor(toolName: string);
	}

	export class ChatDebugEventModelTurnContent {
		requestName: string;

		model?: string;

		status?: string;

		durationInMillis?: number;

		timeToFirstTokenInMillis?: number;

		requestId?: string;

		maxInputTokens?: number;

		maxOutputTokens?: number;

		inputTokens?: number;

		outputTokens?: number;

		cachedTokens?: number;

		totalTokens?: number;

		requestOptions?: string;

		errorMessage?: string;

		sections?: ChatDebugMessageSection[];

		constructor(requestName: string);
	}

	export class ChatDebugEventHookContent {
		hookType: string;

		command?: string;

		result?: ChatDebugHookResult;

		durationInMillis?: number;

		input?: string;

		output?: string;

		errorMessage?: string;

		exitCode?: number;

		constructor(hookType: string);
	}

	export enum ChatDebugHookResult {
		Success = 0,
		Error = 1,
		NonBlockingError = 2
	}

	export type ChatDebugResolvedEventContent = ChatDebugEventTextContent | ChatDebugEventMessageContent | ChatDebugEventToolCallContent | ChatDebugEventModelTurnContent | ChatDebugEventHookContent | ChatDebugUserMessageEvent | ChatDebugAgentResponseEvent;

	export type ChatDebugEvent = ChatDebugToolCallEvent | ChatDebugModelTurnEvent | ChatDebugGenericEvent | ChatDebugSubagentInvocationEvent | ChatDebugUserMessageEvent | ChatDebugAgentResponseEvent;

	export interface ChatDebugLogProvider {
		provideChatDebugLog(
			sessionResource: Uri,
			progress: Progress<ChatDebugEvent>,
			token: CancellationToken
		): ProviderResult<ChatDebugEvent[]>;

		resolveChatDebugLogEvent?(
			eventId: string,
			token: CancellationToken
		): ProviderResult<ChatDebugResolvedEventContent>;

		provideChatDebugLogExport?(
			sessionResource: Uri,
			options: ChatDebugLogExportOptions,
			token: CancellationToken
		): ProviderResult<Uint8Array>;











		resolveChatDebugLogImport?(
			data: Uint8Array,
			token: CancellationToken
		): ProviderResult<ChatDebugLogImportResult>;

		provideAvailableDebugSessionResources?(
			token: CancellationToken
		): ProviderResult<{ uri: Uri; title?: string }[]>;
	}

	export namespace chat {
		export function registerChatDebugLogProvider(provider: ChatDebugLogProvider): Disposable;

		export const onDidReceiveChatDebugEvent: Event<ChatDebugEvent>;
	}

	export interface ChatDebugLogExportOptions {
		readonly coreEvents: readonly ChatDebugEvent[];





		readonly sessionTitle?: string;
	}

	export interface ChatDebugLogImportResult {
		readonly uri: Uri;

		readonly sessionTitle?: string;
	}
}
