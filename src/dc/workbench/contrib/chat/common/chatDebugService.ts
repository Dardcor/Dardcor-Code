/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

export const CHAT_DEBUG_HAS_ACTIVE_SESSION = new RawContextKey<boolean>('chatDebug.hasActiveSession', false);
export const CHAT_DEBUG_ACTIVE_SESSION_IS_AGENT_HOST = new RawContextKey<boolean>('chatDebug.activeSessionIsAgentHost', false);

export enum ChatDebugLogLevel {
	Trace = 0,
	Info = 1,
	Warning = 2,
	Error = 3
}

export enum ChatDebugHookResult {
	Success = 0,
	Error = 1,
	NonBlockingError = 2
}

export interface IChatDebugEventCommon {
	readonly id?: string;
	readonly sessionResource: URI;
	readonly created: Date;
	readonly parentEventId?: string;
}

export interface IChatDebugToolCallEvent extends IChatDebugEventCommon {
	readonly kind: 'toolCall';
	readonly toolName: string;
	readonly toolCallId?: string;
	readonly input?: string;
	readonly output?: string;
	readonly result?: 'success' | 'error';
	readonly durationInMillis?: number;
}

export interface IChatDebugModelTurnEvent extends IChatDebugEventCommon {
	readonly kind: 'modelTurn';
	readonly model?: string;
	readonly requestName?: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cachedTokens?: number;
	readonly totalTokens?: number;
	readonly copilotUsageNanoAiu?: number;
	readonly durationInMillis?: number;
}

export interface IChatDebugGenericEvent extends IChatDebugEventCommon {
	readonly kind: 'generic';
	readonly name: string;
	readonly details?: string;
	readonly level: ChatDebugLogLevel;
	readonly category?: string;
}

export interface IChatDebugSubagentInvocationEvent extends IChatDebugEventCommon {
	readonly kind: 'subagentInvocation';
	readonly agentName: string;
	readonly description?: string;
	readonly status?: 'running' | 'completed' | 'failed';
	readonly durationInMillis?: number;
	readonly toolCallCount?: number;
	readonly modelTurnCount?: number;
}

export interface IChatDebugMessageSection {
	readonly name: string;
	readonly content: string;
}

export interface IChatDebugUserMessageEvent extends IChatDebugEventCommon {
	readonly kind: 'userMessage';
	readonly message: string;
	readonly sections: readonly IChatDebugMessageSection[];
}

export interface IChatDebugAgentResponseEvent extends IChatDebugEventCommon {
	readonly kind: 'agentResponse';
	readonly message: string;
	readonly sections: readonly IChatDebugMessageSection[];
}

export type IChatDebugEvent = IChatDebugToolCallEvent | IChatDebugModelTurnEvent | IChatDebugGenericEvent | IChatDebugSubagentInvocationEvent | IChatDebugUserMessageEvent | IChatDebugAgentResponseEvent;

export const IChatDebugService = createDecorator<IChatDebugService>('chatDebugService');

export interface IChatDebugService extends IDisposable {
	readonly _serviceBrand: undefined;

	readonly onDidAddEvent: Event<IChatDebugEvent>;

	readonly onDidClearProviderEvents: Event<URI>;

	readonly onDidEndSession: Event<URI>;

	log(sessionResource: URI, name: string, details?: string, level?: ChatDebugLogLevel, options?: { id?: string; category?: string; parentEventId?: string }): void;

	addEvent(event: IChatDebugEvent): void;

	addProviderEvent(event: IChatDebugEvent): void;

	getEvents(sessionResource?: URI): readonly IChatDebugEvent[];

	getSessionResources(): readonly URI[];

	activeSessionResource: URI | undefined;

	clear(): void;

	registerProvider(provider: IChatDebugLogProvider): IDisposable;

	hasInvokedProviders(sessionResource: URI): boolean;

	invokeProviders(sessionResource: URI): Promise<void>;

	endSession(sessionResource: URI): void;

	resolveEvent(eventId: string): Promise<IChatDebugResolvedEventContent | undefined>;

	exportLog(sessionResource: URI): Promise<Uint8Array | undefined>;





	importLog(data: Uint8Array): Promise<URI | undefined>;

	isCoreEvent(event: IChatDebugEvent): boolean;

	setImportedSessionTitle(sessionResource: URI, title: string): void;

	getImportedSessionTitle(sessionResource: URI): string | undefined;

	readonly onDidChangeAvailableSessionResources: Event<void>;

	addAvailableSessionResources(resources: readonly { uri: URI; title?: string }[]): void;

	getAvailableSessionResources(): readonly URI[];

	registerAvailableSessionsFetcher(fetcher: (token: CancellationToken) => Promise<{ uri: URI; title?: string }[]>): IDisposable;

	getHistoricalSessionTitle(sessionResource: URI): string | undefined;

}

export interface IChatDebugEventTextContent {
	readonly kind: 'text';
	readonly value: string;
}

export type ChatDebugFileStatus = 'loaded' | 'skipped';

export interface IChatDebugFileEntry {
	readonly uri: URI;
	readonly name?: string;
	readonly status: ChatDebugFileStatus;
	readonly storage?: string;
	readonly extensionId?: string;
	readonly skipReason?: string;
	readonly errorMessage?: string;
	readonly duplicateOf?: URI;
}

export interface IChatDebugSourceFolderEntry {
	readonly uri: URI;
	readonly storage: string;
}

export interface IChatDebugEventFileListContent {
	readonly kind: 'fileList';
	readonly discoveryType: string;
	readonly durationInMillis: number;
	readonly files: readonly IChatDebugFileEntry[];
	readonly sourceFolders?: readonly IChatDebugSourceFolderEntry[];
}

export interface IChatDebugEventMessageContent {
	readonly kind: 'message';
	readonly type: 'user' | 'agent';
	readonly message: string;
	readonly sections: readonly IChatDebugMessageSection[];
}

export interface IChatDebugEventToolCallContent {
	readonly kind: 'toolCall';
	readonly toolName: string;
	readonly result?: 'success' | 'error';
	readonly durationInMillis?: number;
	readonly input?: string;
	readonly output?: string;
}

export interface IChatDebugEventModelTurnContent {
	readonly kind: 'modelTurn';
	readonly requestName: string;
	readonly model?: string;
	readonly status?: string;
	readonly durationInMillis?: number;
	readonly timeToFirstTokenInMillis?: number;
	readonly requestId?: string;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly cachedTokens?: number;
	readonly totalTokens?: number;
	readonly requestOptions?: string;
	readonly errorMessage?: string;
	readonly sections?: readonly IChatDebugMessageSection[];
}

export interface IChatDebugEventHookContent {
	readonly kind: 'hook';
	readonly hookType: string;
	readonly command?: string;
	readonly result?: ChatDebugHookResult;
	readonly durationInMillis?: number;
	readonly input?: string;
	readonly output?: string;
	readonly exitCode?: number;
	readonly errorMessage?: string;
}

export interface IChatDebugCustomizationLogEntry {
	readonly category: 'applying' | 'skipped' | 'referenced' | 'skill' | 'custom-agent' | 'hook';
	readonly name: string;
	readonly uri?: URI;
	readonly reason?: string;
}

export interface IChatDebugEventCustomizationSummaryContent {
	readonly kind: 'customizationSummary';
	readonly resolutionLogs: readonly IChatDebugCustomizationLogEntry[];
	readonly durationInMillis: number;
	readonly counts: {
		readonly instructions: number;
		readonly skills: number;
		readonly agents: number;
		readonly hooks: number;
		readonly skipped: number;
	};
}

export type IChatDebugResolvedEventContent = IChatDebugEventTextContent | IChatDebugEventFileListContent | IChatDebugEventMessageContent | IChatDebugEventToolCallContent | IChatDebugEventModelTurnContent | IChatDebugEventHookContent | IChatDebugEventCustomizationSummaryContent;

export interface IChatDebugLogProvider {
	provideChatDebugLog(sessionResource: URI, token: CancellationToken): Promise<IChatDebugEvent[] | undefined>;
	resolveChatDebugLogEvent?(eventId: string, token: CancellationToken): Promise<IChatDebugResolvedEventContent | undefined>;
	provideChatDebugLogExport?(sessionResource: URI, token: CancellationToken): Promise<Uint8Array | undefined>;
	resolveChatDebugLogImport?(data: Uint8Array, token: CancellationToken): Promise<URI | undefined>;
}
