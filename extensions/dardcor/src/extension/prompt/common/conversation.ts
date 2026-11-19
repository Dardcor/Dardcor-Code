/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptReference, Raw } from '@vscode/prompt-tsx';
import type { ChatLanguageModelToolReference, ChatRequest, ChatRequestEditedFileEvent, ChatResponseStream, ChatResult, LanguageModelToolResult } from 'vscode';
import { FilterReason } from '../../../platform/networking/common/openai';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { isLocation, toLocation } from '../../../util/common/types';
import { ResourceMap } from '../../../util/dardcor/base/common/map';
import { assertType } from '../../../util/dardcor/base/common/types';
import { URI } from '../../../util/dardcor/base/common/uri';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { Location, Range } from '../../../dardcorTypes';
import { InternalToolReference, IToolCallRound } from '../common/intents';
import { ChatVariablesCollection } from './chatVariablesCollection';
import { isContinueOnError, isSwitchToAutoOnRateLimit, isToolCallLimitAcceptance } from './specialRequestTypes';
import { ToolCallRound } from './toolCallRound';
export { PromptReference } from '@vscode/prompt-tsx';

export enum TurnStatus {
	InProgress = 'in-progress',
	Success = 'success',
	Cancelled = 'cancelled',
	OffTopic = 'off-topic',
	Filtered = 'filtered',
	PromptFiltered = 'prompt-filtered',
	Error = 'error',
}

export type TurnMessage = {
	readonly type: 'user' | 'follow-up' | 'template' | 'offtopic-detection' | 'model' | 'meta' | 'server';
	readonly name?: string;
	message: string;
};


export abstract class PromptMetadata {
	readonly _marker: undefined;
	toString(): string {
		return Object.getPrototypeOf(this).constructor.name;
	}
}

export class RequestDebugInformation {
	constructor(
		readonly uri: URI,
		readonly intentId: string,
		readonly languageId: string,
		readonly initialDocumentText: string,
		readonly userPrompt: string,
		readonly userSelection: Range
	) { }
}

export class Turn {

	private _references: readonly PromptReference[] = [];

	private _responseInfo?: { message: TurnMessage | undefined; status: TurnStatus; responseId: string | undefined; chatResult?: ChatResult };

	private readonly _metadata = new Map<unknown, unknown[]>();

	private _pendingSummaries: { toolCallRoundId: string; text: string }[] = [];

	public readonly startTime = Date.now();

	static fromRequest(
		id: string | undefined,
		request: ChatRequest
	) {
		return new Turn(
			id,
			{ message: request.prompt, type: 'user' },
			new ChatVariablesCollection(request.references),
			request.toolReferences.map(InternalToolReference.from),
			request.editedFileEvents,
			request.acceptedConfirmationData,
			isToolCallLimitAcceptance(request) || isContinueOnError(request) || isSwitchToAutoOnRateLimit(request),
			request.modeInstructions2,
		);
	}

	constructor(
		readonly id: string = generateUuid(),
		readonly request: TurnMessage,
		private readonly _promptVariables: ChatVariablesCollection | undefined = undefined,
		private readonly _toolReferences: readonly InternalToolReference[] = [],
		readonly editedFileEvents?: ChatRequestEditedFileEvent[],
		readonly acceptedConfirmationData?: unknown[],
		readonly isContinuation = false,
		readonly modeInstructions?: ChatRequest['modeInstructions2'],
	) { }

	get promptVariables(): ChatVariablesCollection | undefined {
		return this._promptVariables;
	}

	get toolReferences(): readonly InternalToolReference[] {
		return this._toolReferences;
	}

	get references(): readonly PromptReference[] {
		return this._references;
	}

	addReferences(newReferences: readonly PromptReference[]) {
		this._references = getUniqueReferences([...this._references, ...newReferences]);
	}


	get responseMessage(): TurnMessage | undefined {
		return this._responseInfo?.message;
	}

	get responseStatus(): TurnStatus {
		return this._responseInfo?.status ?? TurnStatus.InProgress;
	}

	get responseId(): string | undefined {
		return this._responseInfo?.responseId;
	}

	get responseChatResult(): ChatResult | undefined {
		return this._responseInfo?.chatResult;
	}

	get resultMetadata(): Partial<IResultMetadata> | undefined {
		return this._responseInfo?.chatResult?.metadata;
	}

	get renderedUserMessage(): string | Raw.ChatCompletionContentPart[] | undefined {
		const metadata = this.resultMetadata;
		return metadata?.renderedUserMessage;
	}

	private _filledInMissingRounds: IToolCallRound[] | undefined;

	get rounds(): readonly IToolCallRound[] {
		const metadata = this.resultMetadata;
		const rounds = metadata?.toolCallRounds;
		if (!rounds || rounds.length === 0) {
			if (this._filledInMissingRounds?.length) {
				return this._filledInMissingRounds;
			}

			const response = this.responseMessage?.message ?? '';
			this._filledInMissingRounds = [new ToolCallRound(response, [], undefined, this.id)];
			return this._filledInMissingRounds;
		}

		return rounds;
	}

	setResponse(status: TurnStatus, message: TurnMessage | undefined, responseId: string | undefined, chatResult: ChatResult | undefined) {
		if (this._responseInfo?.status === TurnStatus.Cancelled) {
			return;
		}

		assertType(!this._responseInfo);
		this._responseInfo = { message, status, responseId, chatResult };
	}



	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getMetadata<T extends object>(key: new (...args: any[]) => T): T | undefined {
		return this._metadata.get(key)?.at(-1) as T | undefined;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getAllMetadata<T extends object>(key: new (...args: any[]) => T): T[] | undefined {
		return this._metadata.get(key) as T[] | undefined;
	}

	setMetadata<T extends object>(value: T): void {
		const key = Object.getPrototypeOf(value).constructor;
		const arr = this._metadata.get(key) ?? [];
		arr.push(value);
		this._metadata.set(key, arr);
	}

	addPendingSummary(toolCallRoundId: string, text: string): void {
		this._pendingSummaries.push({ toolCallRoundId, text });
	}

	get pendingSummaries(): readonly { toolCallRoundId: string; text: string }[] {
		return this._pendingSummaries;
	}
}

export function normalizeSummariesOnRounds(turns: readonly Turn[]): void {
	for (const [idx, turn] of turns.entries()) {
		const turnSummaries = turn.resultMetadata?.summaries ?? (turn.resultMetadata?.summary ? [turn.resultMetadata.summary] : turn.pendingSummaries);
		const turnSummary = turnSummaries.at(-1);
		if (!turnSummary) {
			continue;
		}
		const roundInTurn = turn.rounds.find(round => round.id === turnSummary.toolCallRoundId);
		if (roundInTurn) {
			roundInTurn.summary = turnSummary.text;
		} else {
			const previousTurns = turns.slice(0, idx);
			for (const turn of previousTurns) {
				const roundInPreviousTurn = turn.rounds.find(round => round.id === turnSummary.toolCallRoundId);
				if (roundInPreviousTurn) {
					roundInPreviousTurn.summary = turnSummary.text;
					break;
				}
			}
		}
	}
}

export interface IConversationState {
	readonly turns: Turn[];
}

export class Conversation {

	private readonly _turns: Turn[] = [];

	constructor(
		readonly sessionId: string,
		turns: Turn[]
	) {
		assertType(turns.length > 0, 'A conversation must have at least one turn');
		this._turns = turns;
	}

	get turns(): readonly Turn[] {
		return this._turns;
	}

	getLatestTurn(): Turn {
		return this._turns.at(-1)!;
	}
}


export type ResponseStreamParticipant = (inStream: ChatResponseStream) => ChatResponseStream;

export function getUniqueReferences(references: PromptReference[]): PromptReference[] {
	const groupedPromptReferences: ResourceMap<PromptReference[] | PromptReference> = new ResourceMap();
	const variableReferences: PromptReference[] = [];

	const getCombinedRange = (a: Range, b: Range): Range | undefined => {
		if (a.contains(b)) {
			return a;
		}

		if (b.contains(a)) {
			return b;
		}

		const [firstRange, lastRange] = (a.start.line < b.start.line) ? [a, b] : [b, a];
		if (firstRange.end.line >= (lastRange.start.line - 1)) {
			return new Range(firstRange.start, lastRange.end);
		}

		return undefined;
	};

	references.forEach(targetReference => {
		const refAnchor = targetReference.anchor;
		if ('variableName' in refAnchor) {
			variableReferences.push(targetReference);
		} else if (!isLocation(refAnchor)) {
			groupedPromptReferences.set(refAnchor, targetReference);
		} else {
			const existingRefs = groupedPromptReferences.get(refAnchor.uri);
			const asValidLocation = toLocation(refAnchor);
			if (!asValidLocation) {
				return;
			}
			if (!existingRefs) {
				groupedPromptReferences.set(refAnchor.uri, [new PromptReference(asValidLocation, undefined, targetReference.options)]);
			} else if (!(existingRefs instanceof PromptReference)) {
				const oldLocationsToKeep: Location[] = [];
				let newRange = asValidLocation.range;
				existingRefs.forEach(existingRef => {
					if ('variableName' in existingRef.anchor) {
						return;
					}

					if (!isLocation(existingRef.anchor)) {
						return;
					}
					const existingRange = toLocation(existingRef.anchor);
					if (!existingRange) {
						return;
					}
					const combinedRange = getCombinedRange(newRange, existingRange.range);
					if (combinedRange) {
						newRange = combinedRange;
					} else {
						oldLocationsToKeep.push(existingRange);
					}
				});
				const newRangeLocation: Location = {
					uri: refAnchor.uri,
					range: newRange,
				};
				groupedPromptReferences.set(
					refAnchor.uri,
					[...oldLocationsToKeep, newRangeLocation]
						.sort((a, b) => a.range.start.line - b.range.start.line || a.range.end.line - b.range.end.line)
						.map(location => new PromptReference(location, undefined, targetReference.options)));

			}
		}
	});

	const finalValues = Array.from(groupedPromptReferences.keys())
		.sort((a, b) => a.toString().localeCompare(b.toString()))
		.map(e => {
			const values = groupedPromptReferences.get(e);
			if (!values) {
				return [];
			}
			return values;
		}).flat();

	return [
		...finalValues,
		...variableReferences
	];
}

export type CodeBlock = { readonly code: string; readonly language?: string; readonly resource?: URI; readonly markdownBeforeBlock?: string };

export interface IResultMetadata {
	modelMessageId: string;
	responseId: string;
	sessionId: string;
	agentId: string;
	renderedUserMessage?: Raw.ChatCompletionContentPart[];
	renderedGlobalContext?: Raw.ChatCompletionContentPart[];
	globalContextCacheKey?: string;
	command?: string;
	filterCategory?: FilterReason;

	codeBlocks?: readonly CodeBlock[];

	toolCallRounds?: readonly IToolCallRound[];
	toolCallResults?: Record<string, LanguageModelToolResult>;
	maxToolCallsExceeded?: boolean;
	summary?: {
		toolCallRoundId: string;
		text: string;
		source?: 'foreground' | 'background';
		outcome?: string;
		model?: string;
		summarizationMode?: string;
		durationMs?: number;
		contextLengthBefore?: number;
		numRounds?: number;
		numRoundsSinceLastSummarization?: number;
		usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
	};
	summaries?: readonly {
		toolCallRoundId: string;
		text: string;
		source?: 'foreground' | 'background';
		outcome?: string;
		model?: string;
		summarizationMode?: string;
		durationMs?: number;
		contextLengthBefore?: number;
		numRounds?: number;
		numRoundsSinceLastSummarization?: number;
		usage?: { prompt_tokens: number; completion_tokens: number; prompt_tokens_details?: { cached_tokens?: number } };
	}[];
	resolvedModel?: string;
	promptTokens?: number;
	outputTokens?: number;
	shouldAutoSwitchToAuto?: boolean;
}

export interface ICopilotChatResultIn extends ChatResult {
	metadata?: Partial<IResultMetadata>;
}

export interface ICopilotChatResult extends ChatResult {
	metadata: IResultMetadata;
}

export class RenderedUserMessageMetadata {
	constructor(
		readonly renderedUserMessage: Raw.ChatCompletionContentPart[],
	) { }
}

export class GlobalContextMessageMetadata {
	constructor(
		readonly renderedGlobalContext: Raw.ChatCompletionContentPart[],
		readonly cacheKey: string
	) { }
}

export class CustomizationsIndexMetadata {
	constructor(
		readonly value: string,
		readonly toolReferences: readonly ChatLanguageModelToolReference[] | undefined,
		readonly cacheKey: string
	) { }
}

export class TurnTokenUsageMetadata {
	constructor(
		readonly promptTokens: number,
		readonly outputTokens: number,
	) { }
}

export function getGlobalContextCacheKey(accessor: ServicesAccessor): string {
	const workspaceService = accessor.get(IWorkspaceService);
	return workspaceService.getWorkspaceFolders().map(folder => folder.toString()).join(',');
}
