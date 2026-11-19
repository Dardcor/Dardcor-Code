/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { NotebookDocumentSnapshot } from '../../../platform/editing/common/notebookDocumentSnapshot';
import { TextDocumentSnapshot } from '../../../platform/editing/common/textDocumentSnapshot';
import { OpenAIContextManagementResponse } from '../../../platform/networking/common/openai';
import { ThinkingData } from '../../../platform/thinking/common/thinking';
import { createServiceIdentifier } from '../../../util/common/services';
import { ResourceMap, ResourceSet } from '../../../util/dardcor/base/common/map';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { ChatRequest } from '../../../dardcorTypes';
import { getToolName } from '../../tools/common/toolNames';
import { IToolGrouping } from '../../tools/common/virtualTools/virtualToolTypes';
import { ChatVariablesCollection } from './chatVariablesCollection';
import { Conversation, Turn } from './conversation';

export interface IToolCall {
	name: string;
	arguments: string;
	id: string;
}

export interface IToolCallRound {
	id: string;
	summary?: string;
	response: string;
	toolInputRetry: number;
	toolCalls: IToolCall[];
	thinking?: ThinkingData;
	statefulMarker?: string;
	statefulMarkerSummarizedAtRoundId?: string;
	compaction?: OpenAIContextManagementResponse;
	timestamp?: number;
	hookContext?: string;
	phase?: string;
	modelId?: string;
}

export interface InternalToolReference extends vscode.ChatLanguageModelToolReference {
	readonly id: string;
	readonly input?: Object;
}

export namespace InternalToolReference {
	export function from(base: vscode.ChatLanguageModelToolReference): InternalToolReference {
		return {
			...base,
			id: generateUuid(),
			name: getToolName(base.name),
		};
	}
}

export interface IBuildPromptContext {
	readonly requestId?: string;
	readonly query: string;
	readonly history: readonly Turn[];
	readonly chatVariables: ChatVariablesCollection;
	readonly workingSet?: IWorkingSet;
	readonly tools?: {
		readonly toolReferences: readonly InternalToolReference[];
		readonly toolInvocationToken: vscode.ChatParticipantToolToken;
		readonly availableTools: readonly vscode.LanguageModelToolInformation[];
		readonly subAgentInvocationId?: string;
		readonly subAgentName?: string;
	};
	readonly modeInstructions?: vscode.ChatRequestModeInstructions;

	readonly toolCallRounds?: readonly IToolCallRound[];
	readonly toolCallResults?: Record<string, vscode.LanguageModelToolResult>;
	readonly toolGrouping?: IToolGrouping;

	turnEditedDocuments?: ResourceMap<NotebookDocumentSnapshot | TextDocumentSnapshot>;

	readonly allowedEditUris?: ResourceSet;

	readonly editedFileEvents?: readonly vscode.ChatRequestEditedFileEvent[];
	readonly conversation?: Conversation;
	readonly request?: ChatRequest;
	readonly stream?: vscode.ChatResponseStream;
	readonly isContinuation?: boolean;
	readonly hasStopHookQuery?: boolean;
	readonly additionalHookContext?: string;
	readonly parentHeaderRequestId?: string;
	readonly parentModelCallId?: string;
}

export function getSubAgentInvocationId(context: IBuildPromptContext): string | undefined {
	return context.tools?.subAgentInvocationId ?? context.request?.subAgentInvocationId;
}

export const IBuildPromptContext = createServiceIdentifier<IBuildPromptContext>('IBuildPromptContext');

export enum WorkingSetEntryState {
	Initial = 0,
	Undecided = 1,
	Accepted = 2,
	Rejected = 3,
}

export interface ITextDocumentWorkingSetEntry {
	readonly document: TextDocumentSnapshot;
	readonly range?: vscode.Range;
	readonly state: WorkingSetEntryState;
	readonly isMarkedReadonly: boolean | undefined;
}

export interface INotebookWorkingSetEntry {
	readonly document: NotebookDocumentSnapshot;
	readonly range?: vscode.Range;
	readonly state: WorkingSetEntryState;
	readonly isMarkedReadonly: boolean | undefined;
}


export type IWorkingSetEntry = ITextDocumentWorkingSetEntry | INotebookWorkingSetEntry;

export type IWorkingSet = readonly IWorkingSetEntry[];

export function isTextDocumentWorkingSetEntry(entry: IWorkingSetEntry): entry is ITextDocumentWorkingSetEntry {
	return (entry.document instanceof TextDocumentSnapshot);
}

export function isNotebookWorkingSetEntry(entry: IWorkingSetEntry): entry is INotebookWorkingSetEntry {
	return (entry.document instanceof NotebookDocumentSnapshot);
}
