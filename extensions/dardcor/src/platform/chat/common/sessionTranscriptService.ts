/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import { URI } from '../../../util/dardcor/base/common/uri';

export const ISessionTranscriptService = createServiceIdentifier<ISessionTranscriptService>('ISessionTranscriptService');


interface TranscriptEntryBase {
	readonly type: string;
	readonly data: unknown;
	readonly id: string;
	readonly timestamp: string;
	readonly parentId: string | null;
}

export interface SessionStartData {
	readonly sessionId: string;
	readonly version: number;
	readonly producer: string;
	readonly dardcorVersion: string;
	readonly vscodeVersion: string;
	readonly startTime: string;
	readonly context?: {
		readonly cwd?: string;
	};
}

export interface SessionStartEntry extends TranscriptEntryBase {
	readonly type: 'session.start';
	readonly data: SessionStartData;
}

export interface UserMessageData {
	readonly content: string;
	readonly attachments?: readonly unknown[];
}

export interface UserMessageEntry extends TranscriptEntryBase {
	readonly type: 'user.message';
	readonly data: UserMessageData;
}

export interface AssistantTurnStartData {
	readonly turnId: string;
}

export interface AssistantTurnStartEntry extends TranscriptEntryBase {
	readonly type: 'assistant.turn_start';
	readonly data: AssistantTurnStartData;
}

export interface ToolRequest {
	readonly toolCallId: string;
	readonly name: string;
	readonly arguments: string;
	readonly type: 'function';
}

export interface AssistantMessageData {
	readonly messageId: string;
	readonly content: string;
	readonly toolRequests: readonly ToolRequest[];
	readonly reasoningText?: string;
}

export interface AssistantMessageEntry extends TranscriptEntryBase {
	readonly type: 'assistant.message';
	readonly data: AssistantMessageData;
}

export interface ToolExecutionStartData {
	readonly toolCallId: string;
	readonly toolName: string;
	readonly arguments: unknown;
}

export interface ToolExecutionStartEntry extends TranscriptEntryBase {
	readonly type: 'tool.execution_start';
	readonly data: ToolExecutionStartData;
}

export interface ToolExecutionCompleteData {
	readonly toolCallId: string;
	readonly success: boolean;
	readonly result?: {
		readonly content: string;
	};
}

export interface ToolExecutionCompleteEntry extends TranscriptEntryBase {
	readonly type: 'tool.execution_complete';
	readonly data: ToolExecutionCompleteData;
}

export interface AssistantTurnEndData {
	readonly turnId: string;
}

export interface AssistantTurnEndEntry extends TranscriptEntryBase {
	readonly type: 'assistant.turn_end';
	readonly data: AssistantTurnEndData;
}

export type TranscriptEntry =
	| SessionStartEntry
	| UserMessageEntry
	| AssistantTurnStartEntry
	| AssistantMessageEntry
	| ToolExecutionStartEntry
	| ToolExecutionCompleteEntry
	| AssistantTurnEndEntry;



export interface IHistoricalToolCall {
	readonly name: string;
	readonly arguments: string;
	readonly id: string;
}

export interface IHistoricalToolCallRound {
	readonly response: string;
	readonly toolCalls: readonly IHistoricalToolCall[];
	readonly reasoningText?: string;
	readonly timestamp?: number;
}

export interface IHistoricalTurn {
	readonly userMessage: string;
	readonly timestamp: number;
	readonly rounds: readonly IHistoricalToolCallRound[];
}


export interface ISessionTranscriptService {
	readonly _serviceBrand: undefined;

	startSession(sessionId: string, context?: { cwd?: string }, history?: readonly IHistoricalTurn[]): Promise<void>;

	logUserMessage(sessionId: string, content: string, attachments?: readonly unknown[]): void;

	logAssistantTurnStart(sessionId: string, turnId: string): void;

	logAssistantMessage(sessionId: string, content: string, toolRequests: readonly ToolRequest[], reasoningText?: string): void;

	logToolExecutionStart(sessionId: string, toolCallId: string, toolName: string, args: unknown): void;

	logToolExecutionComplete(sessionId: string, toolCallId: string, success: boolean, resultContent?: string): void;

	logAssistantTurnEnd(sessionId: string, turnId: string): void;

	flush(sessionId: string): Promise<void>;

	endSession(sessionId: string): Promise<void>;

	getTranscriptPath(sessionId: string): URI | undefined;

	getLineCount(sessionId: string): number | undefined;

	cleanupOldTranscripts(maxRetained?: number): Promise<void>;

	isTranscriptUri(uri: URI): boolean;
}

export class NullSessionTranscriptService implements ISessionTranscriptService {
	declare readonly _serviceBrand: undefined;

	async startSession(): Promise<void> { }
	logUserMessage(): void { }
	logAssistantTurnStart(): void { }
	logAssistantMessage(): void { }
	logToolExecutionStart(): void { }
	logToolExecutionComplete(): void { }
	logAssistantTurnEnd(): void { }
	async flush(): Promise<void> { }
	async endSession(): Promise<void> { }
	getTranscriptPath(): URI | undefined { return undefined; }
	getLineCount(): number | undefined { return undefined; }
	async cleanupOldTranscripts(): Promise<void> { }
	isTranscriptUri(): boolean { return false; }
}
