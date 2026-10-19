/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { asArray } from '../../../../../base/common/arrays.js';
import { softAssertNever } from '../../../../../base/common/assert.js';
import { VSBuffer, decodeHex, encodeHex } from '../../../../../base/common/buffer.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { BugIndicatingError } from '../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { appendEscapedMarkdownInlineCode, IMarkdownString, MarkdownString, isMarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../../base/common/map.js';
import { revive } from '../../../../../base/common/marshalling.js';
import { Schemas } from '../../../../../base/common/network.js';
import { equals } from '../../../../../base/common/objects.js';
import { IObservable, autorun, constObservable, derived, observableFromEvent, observableSignal, observableSignalFromEvent, observableValue, observableValueOpts, registerAutorunSelfDisposable } from '../../../../../base/common/observable.js';
import { basename, isEqual } from '../../../../../base/common/resources.js';
import { hasKey, WithDefinedProps } from '../../../../../base/common/types.js';
import { URI, UriDto } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { OffsetRange } from '../../../../../editor/common/core/ranges/offsetRange.js';
import { ISelection } from '../../../../../editor/common/core/selection.js';
import { TextEdit } from '../../../../../editor/common/languages.js';
import { EditSuggestionId } from '../../../../../editor/common/textModelEditSource.js';
import { localize } from '../../../../../nls.js';
import { canLog, ILogService, LogLevel } from '../../../../../platform/log/common/log.js';
import { CellUri, ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { ChatRequestToolReferenceEntry, IChatRequestVariableEntry, isImplicitVariableEntry, isStringImplicitContextValue, isStringVariableEntry } from '../attachments/chatVariableEntries.js';
import { migrateLegacyTerminalToolSpecificData } from '../chat.js';
import { IChatRequestOrigin, ISerializableChatRequestOrigin, reviveChatRequestOrigin, serializeChatRequestOrigin } from '../chatRequestOrigin.js';
import { ChatPerfMark, markChat } from '../chatPerf.js';
import { ChatAgentVoteDirection, ChatRequestQueueKind, ChatResponseClearToPreviousToolInvocationReason, ElicitationState, IChatAgentMarkdownContentWithVulnerability, IChatAutoModeResolutionPart, IChatClearToPreviousToolInvocation, IChatCodeCitation, IChatCommandButton, IChatConfirmation, IChatContentInlineReference, IChatContentReference, IChatDisabledClaudeHooksPart, IChatEditingSessionAction, IChatElicitationRequest, IChatElicitationRequestSerialized, IChatExternalEdit, IChatExternalToolInvocationUpdate, IChatExtensionsContent, IChatFollowup, IChatHookPart, IChatInfoMessage, IChatLocationData, IChatMarkdownContent, IChatMcpAuthenticationRequired, IChatMcpServersStarting, IChatMcpServersStartingSerialized, IChatMcpServersStartingSlow, IChatModelReference, IChatMultiDiffData, IChatMultiDiffDataSerialized, IChatNotebookEdit, IChatPlanReview, IChatProgress, IChatProgressMessage, IChatPullRequestContent, IChatQuestionCarousel, IChatResponseCodeblockUriPart, IChatResponseProgressFileTreeData, IChatSendRequestOptions, IChatService, IChatSessionTiming, IChatSystemNotificationPart, IChatTask, IChatTaskSerialized, IChatTextEdit, IChatThinkingPart, IChatToolInvocation, IChatToolInvocationSerialized, IChatTreeData, IChatUndoStop, IChatUsage, IChatUsageModelTotal, IChatUsagePromptTokenDetail, IChatUsedContext, IChatVoiceProgressPart, IChatWarningMessage, IChatWorkspaceEdit, ResponseModelState, ToolConfirmKind, isIUsedContext } from '../chatService/chatService.js';
import { ChatAgentLocation, SessionTypeSelectionReason, ChatModeKind, ChatPermissionLevel } from '../constants.js';
import { ChatToolInvocation } from './chatProgressTypes/chatToolInvocation.js';
import { ChatPlanReviewData } from './chatProgressTypes/chatPlanReviewData.js';
import { ChatQuestionCarouselData } from './chatProgressTypes/chatQuestionCarouselData.js';
import { ToolDataSource, IToolData } from '../tools/languageModelToolsService.js';
import { IChatEditingService, IChatEditingSession, ModifiedFileEntryState } from '../editing/chatEditingService.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier } from '../languageModels.js';
import { IIntendedModelSelection, ModelSelectionReason } from '../modelSelection.js';
import { IChatAgentCommand, IChatAgentData, IChatAgentResult, IChatAgentService, UserSelectedTools, reviveSerializedAgent } from '../participants/chatAgents.js';
import { ChatRequestTextPart, IParsedChatRequest, reviveParsedChatRequest } from '../requestParser/chatParserTypes.js';
import { chatSessionResourceToId, LocalChatSessionUri } from './chatUri.js';
import { ObjectMutationLog } from './objectMutationLog.js';


export interface IChatPendingRequest {
	readonly request: IChatRequestModel;
	readonly kind: ChatRequestQueueKind;
	readonly sendOptions: IChatSendRequestOptions;
}

export interface ISerializableSendOptions {
	modeInfo?: IChatRequestModeInfo;
	userSelectedModelId?: string;
	userSelectedModelConfiguration?: IStringDictionary<unknown>;
	userSelectedTools?: UserSelectedTools;
	instructionContext?: IChatSendRequestOptions['instructionContext'];
	location?: ChatAgentLocation;
	locationData?: IChatLocationData;
	attempt?: number;
	noCommandDetection?: boolean;
	isVoiceModeInput?: boolean;
	agentId?: string;
	agentIdSilent?: string;
	slashCommand?: string;
	confirmation?: string;
	isSystemInitiated?: boolean;
	hideFromTranscript?: boolean;
	systemInitiatedLabel?: string;
	terminalExecutionId?: string;
}

export interface ISerializablePendingRequestData {
	id: string;
	request: ISerializableChatRequestData;
	kind: ChatRequestQueueKind;
	sendOptions: ISerializableSendOptions;
}

export const CHAT_ATTACHABLE_IMAGE_MIME_TYPES: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
};

export function getAttachableImageExtension(mimeType: string): string | undefined {
	return Object.entries(CHAT_ATTACHABLE_IMAGE_MIME_TYPES).find(([_, value]) => value === mimeType)?.[0];
}

export interface IChatRequestVariableData {
	variables: readonly IChatRequestVariableEntry[];
}

export namespace IChatRequestVariableData {
	export function toExport(data: IChatRequestVariableData): IChatRequestVariableData {
		return { variables: data.variables.map(IChatRequestVariableEntry.toExport) };
	}
}

export interface IChatRequestModel {
	readonly id: string;
	readonly timestamp: number;
	readonly requestTimestamp: number | undefined;
	readonly version: number;
	readonly modeInfo?: IChatRequestModeInfo;
	readonly session: IChatModel;
	readonly message: IParsedChatRequest;
	readonly attempt: number;
	readonly variableData: IChatRequestVariableData;
	readonly confirmation?: string;
	readonly locationData?: IChatLocationData;
	readonly attachedContext?: IChatRequestVariableEntry[];
	readonly isCompleteAddedRequest: boolean;
	readonly isTerminalCommand: boolean;
	readonly response?: IChatResponseModel;
	readonly editedFileEvents?: IChatAgentEditedFileEvent[];
	shouldBeRemovedOnSend: IChatRequestDisablement | undefined;
	readonly shouldBeBlocked: IObservable<boolean>;
	setShouldBeBlocked(value: boolean): void;
	readonly modelId?: string;
	readonly userSelectedTools?: UserSelectedTools;
	readonly isSystemInitiated?: boolean;
	readonly isHiddenFromTranscript: boolean;
	readonly isRequestHiddenFromTranscript: boolean;
	readonly systemInitiatedLabel?: string;
	readonly terminalExecutionId?: string;
	readonly origin?: IChatRequestOrigin;
}

export interface ICodeBlockInfo {
	readonly suggestionId: EditSuggestionId;
}

export interface IChatTextEditGroupState {
	sha1: string;
	applied: number;
}

export interface IChatTextEditGroup {
	uri: URI;
	edits: TextEdit[][];
	state?: IChatTextEditGroupState;
	kind: 'textEditGroup';
	done: boolean | undefined;
	isExternalEdit?: boolean;
}

export function isCellTextEditOperation(value: unknown): value is ICellTextEditOperation {
	const candidate = value as ICellTextEditOperation;
	return !!candidate && !!candidate.edit && !!candidate.uri && URI.isUri(candidate.uri);
}

export function isCellTextEditOperationArray(value: ICellTextEditOperation[] | ICellEditOperation[]): value is ICellTextEditOperation[] {
	return value.some(isCellTextEditOperation);
}

export interface ICellTextEditOperation {
	edit: TextEdit;
	uri: URI;
}

export interface IChatNotebookEditGroup {
	uri: URI;
	edits: (ICellTextEditOperation[] | ICellEditOperation[])[];
	state?: IChatTextEditGroupState;
	kind: 'notebookEditGroup';
	done: boolean | undefined;
	isExternalEdit?: boolean;
}

export type IChatProgressHistoryResponseContent =
	| IChatMarkdownContent
	| IChatAgentMarkdownContentWithVulnerability
	| IChatResponseCodeblockUriPart
	| IChatTreeData
	| IChatMultiDiffDataSerialized
	| IChatContentInlineReference
	| IChatProgressMessage
	| IChatSystemNotificationPart
	| IChatCommandButton
	| IChatWarningMessage
	| IChatInfoMessage
	| IChatTask
	| IChatTaskSerialized
	| IChatTextEditGroup
	| IChatNotebookEditGroup
	| IChatConfirmation
	| IChatQuestionCarousel
	| IChatPlanReview
	| IChatExtensionsContent
	| IChatThinkingPart
	| IChatHookPart
	| IChatPullRequestContent
	| IChatWorkspaceEdit
	| IChatExternalEdit
	| IChatAutoModeResolutionPart;

export type IChatProgressResponseContent =
	| IChatProgressHistoryResponseContent
	| IChatToolInvocation
	| IChatToolInvocationSerialized
	| IChatMultiDiffData
	| IChatUndoStop
	| IChatElicitationRequest
	| IChatElicitationRequestSerialized
	| IChatClearToPreviousToolInvocation
	| IChatMcpServersStarting
	| IChatMcpServersStartingSerialized
	| IChatMcpAuthenticationRequired
	| IChatMcpServersStartingSlow
	| IChatDisabledClaudeHooksPart
	| IChatVoiceProgressPart;

export type IChatProgressResponseContentSerialized = Exclude<IChatProgressResponseContent,
	| IChatToolInvocation
	| IChatElicitationRequest
	| IChatTask
	| IChatMultiDiffData
	| IChatMcpServersStarting
	| IChatMcpAuthenticationRequired
	| IChatMcpServersStartingSlow
	| IChatDisabledClaudeHooksPart
	| IChatVoiceProgressPart
>;

const nonHistoryKinds = new Set(['toolInvocation', 'toolInvocationSerialized', 'undoStop', 'voiceProgress']);
function isChatProgressHistoryResponseContent(content: IChatProgressResponseContent): content is IChatProgressHistoryResponseContent {
	return !nonHistoryKinds.has(content.kind);
}

export function toChatHistoryContent(content: ReadonlyArray<IChatProgressResponseContent>): IChatProgressHistoryResponseContent[] {
	return content.filter(isChatProgressHistoryResponseContent);
}

export type IChatProgressRenderableResponseContent = Exclude<IChatProgressResponseContent, IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability | IChatResponseCodeblockUriPart | IChatVoiceProgressPart>;

export interface IResponse {
	readonly value: ReadonlyArray<IChatProgressResponseContent>;
	getMarkdown(): string;
	getFinalResponse(): string;
	toString(): string;
}

export interface IChatResponseModel {
	readonly onDidChange: Event<ChatResponseModelChangeReason>;
	readonly id: string;
	readonly requestId: string;
	readonly request: IChatRequestModel | undefined;
	readonly username: string;
	readonly session: IChatModel;
	readonly agent?: IChatAgentData;
	readonly usedContext: IChatUsedContext | undefined;
	readonly contentReferences: ReadonlyArray<IChatContentReference>;
	readonly codeCitations: ReadonlyArray<IChatCodeCitation>;
	readonly progressMessages: ReadonlyArray<IChatProgressMessage>;
	readonly slashCommand?: IChatAgentCommand;
	readonly agentOrSlashCommandDetected: boolean;
	readonly response: IResponse;
	readonly entireResponse: IResponse;
	readonly timestamp: number;
	readonly completedAt?: number;
	readonly completionTimestamp?: number;
	readonly state: ResponseModelState;
	readonly stateT: ResponseModelStateT;
	readonly confirmationAdjustedTimestamp: IObservable<number>;
	readonly isComplete: boolean;
	readonly isCanceled: boolean;
	readonly isPendingConfirmation: IObservable<{ startedWaitingAt: number; detail?: string } | undefined>;
	readonly isInProgress: IObservable<boolean>;
	readonly isIncomplete: IObservable<boolean>;
	readonly shouldBeRemovedOnSend: IChatRequestDisablement | undefined;
	readonly isHiddenFromTranscript: boolean;
	readonly shouldBeBlocked: IObservable<boolean>;
	readonly isCompleteAddedRequest: boolean;
	readonly isStale: boolean;
	readonly vote: ChatAgentVoteDirection | undefined;
	readonly followups?: IChatFollowup[] | undefined;
	readonly result?: IChatAgentResult;
	readonly usage?: IChatUsage;
	readonly usageObs: IObservable<IChatUsage | undefined>;
	readonly completionTokenCount: number | undefined;
	readonly completionTokenCountObs: IObservable<number | undefined>;
	readonly elapsedMs: number | undefined;
	readonly codeBlockInfos: ICodeBlockInfo[] | undefined;

	initializeCodeBlockInfos(codeBlockInfo: ICodeBlockInfo[]): void;
	addUndoStop(undoStop: IChatUndoStop): void;
	setVote(vote: ChatAgentVoteDirection): void;
	setUsage(usage: IChatUsage): void;
	setElapsedMs(elapsedMs: number): void;
	setResult(result: IChatAgentResult): void;
	setEditApplied(edit: IChatTextEditGroup, editCount: number): boolean;
	resolveInlineReference(resolveId: string, resolvedReference: IChatContentInlineReference): boolean;
	updateContent(progress: IChatProgressResponseContent | IChatTextEdit | IChatNotebookEdit | IChatTask | IChatExternalToolInvocationUpdate, quiet?: boolean): void;
	finalizeUndoState(): void;
}

export type ChatResponseModelChangeReason =
	| { reason: 'other' }
	| { reason: 'completedRequest' }
	| { reason: 'undoStop'; id: string };

export const defaultChatResponseModelChangeReason: ChatResponseModelChangeReason = { reason: 'other' };

export interface IChatRequestModeInfo {
	kind: ChatModeKind | undefined;
	isBuiltin: boolean;
	modeInstructions: IChatRequestModeInstructions | undefined;
	telemetryModeId: 'ask' | 'agent' | 'edit' | 'custom' | 'applyCodeBlock' | undefined;
	telemetryModeName?: string;
	applyCodeBlockSuggestionId: EditSuggestionId | undefined;
	permissionLevel?: ChatPermissionLevel;
}

export interface IChatRequestModeInstructions {
	readonly uri?: URI;
	readonly name: string;
	readonly content: string;
	readonly toolReferences: readonly ChatRequestToolReferenceEntry[];
	readonly allowedSubagents?: readonly string[];
	readonly metadata?: Record<string, boolean | string | number>;
	readonly isBuiltin?: boolean;
}

export interface IChatRequestModelParameters {
	session: ChatModel;
	message: IParsedChatRequest;
	variableData: IChatRequestVariableData;
	timestamp?: number;
	fallbackTimestamp?: number;
	attempt?: number;
	modeInfo?: IChatRequestModeInfo;
	confirmation?: string;
	locationData?: IChatLocationData;
	attachedContext?: IChatRequestVariableEntry[];
	isCompleteAddedRequest?: boolean;
	modelId?: string;
	restoredId?: string;
	editedFileEvents?: IChatAgentEditedFileEvent[];
	userSelectedTools?: UserSelectedTools;
	isSystemInitiated?: boolean;
	isHiddenFromTranscript?: boolean;
	isRequestHiddenFromTranscript?: boolean;
	systemInitiatedLabel?: string;
	terminalExecutionId?: string;
	origin?: IChatRequestOrigin;
	isTerminalCommand?: boolean;
}

export class ChatRequestModel implements IChatRequestModel {
	public readonly id: string;
	public response: ChatResponseModel | undefined;
	public shouldBeRemovedOnSend: IChatRequestDisablement | undefined;
	public readonly timestamp: number;
	public readonly requestTimestamp: number | undefined;
	public readonly message: IParsedChatRequest;
	public readonly isCompleteAddedRequest: boolean;
	public readonly modelId?: string;
	public readonly modeInfo?: IChatRequestModeInfo;
	public readonly userSelectedTools?: UserSelectedTools;
	public readonly isSystemInitiated?: boolean;
	public readonly isHiddenFromTranscript: boolean;
	public readonly isRequestHiddenFromTranscript: boolean;
	public readonly systemInitiatedLabel?: string;
	public readonly terminalExecutionId?: string;
	public readonly isTerminalCommand: boolean;
	public readonly origin?: IChatRequestOrigin;

	private readonly _shouldBeBlocked = observableValue<boolean>(this, false);
	public get shouldBeBlocked(): IObservable<boolean> {
		return this._shouldBeBlocked;
	}

	public setShouldBeBlocked(value: boolean): void {
		this._shouldBeBlocked.set(value, undefined);
	}

	private _session: ChatModel;
	private readonly _attempt: number;
	private _variableData: IChatRequestVariableData;
	private readonly _confirmation?: string;
	private readonly _locationData?: IChatLocationData;
	private readonly _attachedContext?: IChatRequestVariableEntry[];
	private readonly _editedFileEvents?: IChatAgentEditedFileEvent[];

	public get session(): ChatModel {
		return this._session;
	}

	public get attempt(): number {
		return this._attempt;
	}

	public get variableData(): IChatRequestVariableData {
		return this._variableData;
	}

	public set variableData(v: IChatRequestVariableData) {
		this._version++;
		this._variableData = v;
	}

	public get confirmation(): string | undefined {
		return this._confirmation;
	}

	public get locationData(): IChatLocationData | undefined {
		return this._locationData;
	}

	public get attachedContext(): IChatRequestVariableEntry[] | undefined {
		return this._attachedContext;
	}

	public get editedFileEvents(): IChatAgentEditedFileEvent[] | undefined {
		return this._editedFileEvents;
	}

	private _version = 0;
	public get version(): number {
		return this._version;
	}

	constructor(params: IChatRequestModelParameters) {
		this._session = params.session;
		this.message = params.message;
		this._variableData = params.variableData;
		this.requestTimestamp = params.timestamp;
		this.timestamp = params.timestamp ?? params.fallbackTimestamp ?? Date.now();
		this._attempt = params.attempt ?? 0;
		this.modeInfo = params.modeInfo;
		this._confirmation = params.confirmation;
		this._locationData = params.locationData;
		this._attachedContext = params.attachedContext;
		this.isCompleteAddedRequest = params.isCompleteAddedRequest ?? false;
		this.modelId = params.modelId;
		this.id = params.restoredId ?? 'request_' + generateUuid();
		this._editedFileEvents = params.editedFileEvents;
		this.userSelectedTools = params.userSelectedTools;
		this.isSystemInitiated = params.isSystemInitiated;
		this.isHiddenFromTranscript = params.isHiddenFromTranscript ?? false;
		this.isRequestHiddenFromTranscript = this.isHiddenFromTranscript || params.isRequestHiddenFromTranscript === true;
		this.systemInitiatedLabel = params.systemInitiatedLabel;
		this.terminalExecutionId = params.terminalExecutionId;
		this.isTerminalCommand = params.isTerminalCommand ?? false;
		this.origin = params.origin;
	}

	adoptTo(session: ChatModel) {
		this._session = session;
	}
}

class AbstractResponse implements IResponse {
	protected _responseParts: IChatProgressResponseContent[];

	private _responseRepr: string | undefined;

	private _markdownContent: string | undefined;

	get value(): IChatProgressResponseContent[] {
		return this._responseParts;
	}

	constructor(value: IChatProgressResponseContent[]) {
		this._responseParts = value;
	}

	toString(): string {
		if (this._responseRepr === undefined) {
			this._responseRepr = this.computeRepr();
		}
		return this._responseRepr;
	}

	getMarkdown(): string {
		if (this._markdownContent === undefined) {
			this._markdownContent = this.computeMarkdownContent();
		}
		return this._markdownContent;
	}

	getFinalResponse(): string {
		const parts = this._responseParts;
		let i = parts.length - 1;
		while (i >= 0) {
			const part = parts[i];
			if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
				if (part.content.value.length > 0) {
					break;
				}
			} else if (part.kind === 'inlineReference') {
				break;
			}
			i--;
		}

		if (i < 0) {
			return '';
		}

		const end = i;
		while (i >= 0) {
			const part = parts[i];
			if (part.kind === 'markdownContent' || part.kind === 'markdownVuln' || part.kind === 'inlineReference') {
				i--;
			} else {
				break;
			}
		}
		const start = i + 1;

		const segments: string[] = [];
		for (let j = start; j <= end; j++) {
			const part = parts[j];
			if (part.kind === 'inlineReference') {
				segments.push(this.inlineRefToRepr(part));
			} else if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
				if (part.content.value.length > 0) {
					segments.push(part.content.value);
				}
			}
		}
		return segments.join('');
	}

	protected _invalidateRepr() {
		this._responseRepr = undefined;
		this._markdownContent = undefined;
	}

	private computeMarkdownContent(): string {
		const segments: string[] = [];
		for (const part of this._responseParts) {
			if (part.kind === 'inlineReference') {
				segments.push(this.inlineRefToRepr(part));
			} else if (part.kind === 'markdownContent' || part.kind === 'markdownVuln') {
				if (part.content.value.length > 0) {
					segments.push(part.content.value);
				}
			}
		}
		return segments.join('');
	}

	protected computeRepr(): string {
		return this.partsToRepr(this._responseParts);
	}

	private partsToRepr(parts: readonly IChatProgressResponseContent[]): string {
		const blocks: string[] = [];
		let currentBlockSegments: string[] = [];
		let hasEditGroupsAfterLastClear = false;

		for (const part of parts) {
			let segment: { text: string; isBlock?: boolean } | undefined;
			switch (part.kind) {
				case 'clearToPreviousToolInvocation':
					currentBlockSegments = [];
					blocks.length = 0;
					hasEditGroupsAfterLastClear = false;
					continue;
				case 'treeData':
				case 'progressMessage':
				case 'codeblockUri':
				case 'extensions':
				case 'pullRequest':
				case 'undoStop':
				case 'workspaceEdit':
				case 'externalEdit':
				case 'elicitation2':
				case 'elicitationSerialized':
				case 'thinking':
				case 'hook':
				case 'voiceProgress':
				case 'multiDiffData':
				case 'mcpServersStarting':
				case 'mcpAuthenticationRequired':
				case 'mcpServersStartingSlow':
				case 'questionCarousel':
				case 'planReview':
				case 'disabledClaudeHooks':
				case 'autoModeResolution':
					continue;
				case 'systemNotification':
					segment = { text: part.content.value, isBlock: true };
					break;
				case 'toolInvocation':
				case 'toolInvocationSerialized':
					segment = this.getToolInvocationText(part);
					break;
				case 'inlineReference':
					segment = { text: this.inlineRefToRepr(part) };
					break;
				case 'command':
					segment = { text: part.command.title, isBlock: true };
					break;
				case 'textEditGroup':
				case 'notebookEditGroup':
					hasEditGroupsAfterLastClear = true;
					continue;
				case 'confirmation':
					if (part.message instanceof MarkdownString) {
						segment = { text: `${part.title}\n${part.message.value}`, isBlock: true };
						break;
					}
					segment = { text: `${part.title}\n${part.message}`, isBlock: true };
					break;
				case 'markdownContent':
				case 'markdownVuln':
				case 'progressTask':
				case 'progressTaskSerialized':
				case 'warning':
				case 'info':
					segment = { text: part.content.value };
					break;
				default:
					softAssertNever(part);
					continue;
			}

			if (segment.isBlock) {
				if (currentBlockSegments.length) {
					blocks.push(currentBlockSegments.join(''));
					currentBlockSegments = [];
				}
				blocks.push(segment.text);
			} else {
				currentBlockSegments.push(segment.text);
			}
		}

		if (currentBlockSegments.length) {
			blocks.push(currentBlockSegments.join(''));
		}

		if (hasEditGroupsAfterLastClear) {
			blocks.push(localize('editsSummary', "Made changes."));
		}

		return blocks.join('\n\n');
	}

	private inlineRefToRepr(part: IChatContentInlineReference) {
		if ('uri' in part.inlineReference) {
			return this.uriToRepr(part.inlineReference.uri, part.inlineReference.range);
		}

		return 'name' in part.inlineReference
			? appendEscapedMarkdownInlineCode(part.inlineReference.name)
			: this.uriToRepr(part.inlineReference);
	}

	private getToolInvocationText(toolInvocation: IChatToolInvocation | IChatToolInvocationSerialized): { text: string; isBlock?: boolean } {
		const getTerminalDisplayInput = (terminalData: ReturnType<typeof migrateLegacyTerminalToolSpecificData>) => terminalData.presentationOverrides?.commandLine
			?? terminalData.commandLine.forDisplay
			?? terminalData.commandLine.userEdited
			?? terminalData.commandLine.toolEdited
			?? terminalData.commandLine.original;

		let message = '';
		let input = '';

		if (toolInvocation.pastTenseMessage) {
			message = typeof toolInvocation.pastTenseMessage === 'string'
				? toolInvocation.pastTenseMessage
				: toolInvocation.pastTenseMessage.value;
		} else {
			message = typeof toolInvocation.invocationMessage === 'string'
				? toolInvocation.invocationMessage
				: toolInvocation.invocationMessage.value;
		}

		if (toolInvocation.toolSpecificData) {
			if (toolInvocation.toolSpecificData.kind === 'terminal') {
				message = 'Ran terminal command';
				const terminalData = migrateLegacyTerminalToolSpecificData(toolInvocation.toolSpecificData);
				input = getTerminalDisplayInput(terminalData);
			}
		}

		let text = message;
		if (input) {
			text += `: ${input}`;
		}

		if (toolInvocation.kind === 'toolInvocationSerialized' || (toolInvocation.kind === 'toolInvocation' && IChatToolInvocation.isComplete(toolInvocation))) {
			const resultDetails = IChatToolInvocation.resultDetails(toolInvocation);
			if (resultDetails && 'input' in resultDetails) {
				const resultPrefix = toolInvocation.kind === 'toolInvocationSerialized' || IChatToolInvocation.isComplete(toolInvocation) ? 'Completed' : 'Errored';
				const resultInput = toolInvocation.toolSpecificData?.kind === 'terminal'
					? getTerminalDisplayInput(migrateLegacyTerminalToolSpecificData(toolInvocation.toolSpecificData))
					: resultDetails.input;
				text += `\n${resultPrefix} with input: ${resultInput}`;
			}
		}

		return { text, isBlock: true };
	}

	private uriToRepr(uri: URI, range?: IRange): string {
		if (uri.scheme === Schemas.http || uri.scheme === Schemas.https) {
			return uri.toString(false);
		}

		const suffix = !range ? ''
			: range.startLineNumber === range.endLineNumber ? `:${range.startLineNumber}`
				: `:${range.startLineNumber}-${range.endLineNumber}`;
		return appendEscapedMarkdownInlineCode(basename(uri) + suffix);
	}
}

class ResponseView extends AbstractResponse {
	constructor(
		_response: IResponse,
		public readonly undoStop: string,
	) {
		let idx = _response.value.findIndex(v => v.kind === 'undoStop' && v.id === undoStop);
		if (_response.value[idx + 1]?.kind === 'codeblockUri' && _response.value[idx - 1]?.kind === 'markdownContent') {
			idx--;
		}

		super(idx === -1 ? _response.value.slice() : _response.value.slice(0, idx));
	}
}

const DARDCOR_CLOSE_THINK_TAG_REGEX = /<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|◁\/think▷|<\|end_of_thought\|>|\[\/THINK\]/i;
const DARDCOR_OPEN_THINK_TAG_REGEX = /<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>|◁think▷|<\|begin_of_thought\|>|\[THINK\]/i;
const DARDCOR_ANY_THINK_TAG_REGEX = /<(?:think|thinking|thought|reasoning|antThinking)(?:\s+[^>]*)?>|<\/(?:think|thinking|thought|reasoning|antThinking)\s*>|◁\/?think▷|<\|(?:begin|end)_of_thought\|>|\[\/?THINK\]/gi;
const DARDCOR_TOOL_BLOCK_REGEX = /<(?:tool_call|function_call|tool)(?:\s+[^>]*)?>[\s\S]*?(?:<\/(?:tool_call|function_call|tool)>|$)|<(?:function)(?:[=\s][^>]*)?>[\s\S]*?(?:<\/(?:function)>|$)|\[(?:TOOL_CALL|FUNCTION_CALL)\][\s\S]*?(?:\[\/(?:TOOL_CALL|FUNCTION_CALL)\]|$)|```(?:tool_call|json:tool)[\s\S]*?(?:```|$)/gi;
const DARDCOR_TOOL_TAG_REGEX = /<\/?(?:tool_call|function_call|tool|function|parameter|param|arg)(?:[=\s][^>]*)?>|\[\/?(?:TOOL_CALL|FUNCTION_CALL)\]/gi;

export class Response extends AbstractResponse implements IDisposable {
	private readonly _store = new DisposableStore();
	private _onDidChangeValue = this._store.add(new Emitter<void>());
	private _activeReasoning: { part: IChatThinkingPart; startedAt: number } | undefined;
	public get onDidChangeValue() {
		return this._onDidChangeValue.event;
	}

	private _citations: IChatCodeCitation[] = [];


	constructor(value: IMarkdownString | ReadonlyArray<SerializedChatResponsePart>) {
		super(asArray(value).map((v) => (
			'kind' in v ? v :
				isMarkdownString(v) ? { content: v, kind: 'markdownContent' } satisfies IChatMarkdownContent :
					{ kind: 'treeData', treeData: v }
		)));
	}

	dispose(): void {
		this._store.dispose();
	}


	clear(): void {
		this.finalizeReasoningDuration();
		this._responseParts = [];
		this._contentChanged(true);
	}

	clearToPreviousToolInvocation(message?: string): void {
		this.finalizeReasoningDuration();
		let lastToolInvocationIndex = -1;
		for (let i = this._responseParts.length - 1; i >= 0; i--) {
			const part = this._responseParts[i];
			if (part.kind === 'toolInvocation' || part.kind === 'toolInvocationSerialized') {
				lastToolInvocationIndex = i;
				break;
			}
		}
		if (lastToolInvocationIndex !== -1) {
			this._responseParts = this._responseParts.slice(0, lastToolInvocationIndex + 1);
		} else {
			this._responseParts = [];
		}
		if (message) {
			this._responseParts.push({ kind: 'warning', content: new MarkdownString(message) });
		}
		this._contentChanged(true);
	}

	updateContent(progress: IChatProgressResponseContent | IChatTextEdit | IChatNotebookEdit | IChatTask | IChatExternalToolInvocationUpdate, quiet?: boolean): void {
		if (progress.kind !== 'thinking') {
			this.finalizeReasoningDuration();
		}

		if (progress.kind === 'clearToPreviousToolInvocation') {
			if (progress.reason === ChatResponseClearToPreviousToolInvocationReason.CopyrightContentRetry) {
				this.clearToPreviousToolInvocation(localize('copyrightContentRetry', "Response cleared due to possible match to public code, retrying with modified prompt."));
			} else if (progress.reason === ChatResponseClearToPreviousToolInvocationReason.FilteredContentRetry) {
				this.clearToPreviousToolInvocation(localize('filteredContentRetry', "Response cleared due to content safety filters, retrying with modified prompt."));
			} else {
				this.clearToPreviousToolInvocation();
			}
			return;
		} else if (progress.kind === 'markdownContent') {
			let mdText = progress.content.value;
			if (DARDCOR_CLOSE_THINK_TAG_REGEX.test(mdText)) {
				const closeMatch = DARDCOR_CLOSE_THINK_TAG_REGEX.exec(mdText);
				if (closeMatch) {
					const closeIndex = closeMatch.index;
					const closeLen = closeMatch[0].length;
					const preText = mdText.slice(0, closeIndex);
					const postText = mdText.slice(closeIndex + closeLen);

					const openMatch = DARDCOR_OPEN_THINK_TAG_REGEX.exec(preText);
					if (openMatch) {
						const beforeOpen = preText.slice(0, openMatch.index);
						const thinkingInside = preText.slice(openMatch.index + openMatch[0].length);
						if (thinkingInside) {
							this.updateContent({ kind: 'thinking', value: thinkingInside }, quiet);
						}
						mdText = (beforeOpen ? beforeOpen : '') + postText;
					} else {
						const lastPart = this._responseParts.filter(p => p.kind !== 'textEditGroup' && !isNestedSubagentResponsePart(p)).at(-1);
						let fullThinking = preText;
						if (lastPart && lastPart.kind === 'markdownContent') {
							fullThinking = lastPart.content.value + preText;
							const pIdx = this._responseParts.indexOf(lastPart);
							if (pIdx !== -1) {
								this._responseParts.splice(pIdx, 1);
							}
						}
						if (fullThinking) {
							this.updateContent({ kind: 'thinking', value: fullThinking }, quiet);
						}
						mdText = postText;
					}

					if (!mdText.trim()) {
						this._contentChanged(quiet);
						return;
					}
				}
			} else if (DARDCOR_OPEN_THINK_TAG_REGEX.test(mdText)) {
				const openMatch = DARDCOR_OPEN_THINK_TAG_REGEX.exec(mdText);
				if (openMatch) {
					const beforeOpen = mdText.slice(0, openMatch.index);
					const afterOpen = mdText.slice(openMatch.index + openMatch[0].length);
					if (afterOpen) {
						this.updateContent({ kind: 'thinking', value: afterOpen }, quiet);
					}
					if (!beforeOpen.trim()) {
						this._contentChanged(quiet);
						return;
					}
					mdText = beforeOpen;
				}
			}

			if (DARDCOR_ANY_THINK_TAG_REGEX.test(mdText)) {
				mdText = mdText.replace(DARDCOR_ANY_THINK_TAG_REGEX, '');
			}
			if (DARDCOR_TOOL_BLOCK_REGEX.test(mdText)) {
				mdText = mdText.replace(DARDCOR_TOOL_BLOCK_REGEX, '');
			}
			if (DARDCOR_TOOL_TAG_REGEX.test(mdText)) {
				mdText = mdText.replace(DARDCOR_TOOL_TAG_REGEX, '');
			}
			if (/<[\/|]?(?:tool|func|param|think)[^>]*$/i.test(mdText)) {
				mdText = mdText.replace(/<[\/|]?(?:tool|func|param|think)[^>]*$/i, '');
			}
			if (!mdText.trim()) {
				this._contentChanged(quiet);
				return;
			}

			const effectiveContent = mdText === progress.content.value ? progress.content : new MarkdownString(mdText);
			const partToPush: IChatMarkdownContent = { ...progress, content: effectiveContent };

			const lastResponsePart = this._responseParts
				.filter(p => p.kind !== 'textEditGroup' && !isNestedSubagentResponsePart(p))
				.at(-1);

			if (!lastResponsePart || lastResponsePart.kind !== 'markdownContent' || !canMergeMarkdownStrings(lastResponsePart.content, partToPush.content)) {
				this._responseParts.push(partToPush);
			} else {
				const idx = this._responseParts.indexOf(lastResponsePart);
				this._responseParts[idx] = { ...lastResponsePart, content: appendMarkdownString(lastResponsePart.content, partToPush.content) };
			}
			this._contentChanged(quiet);
		} else if (progress.kind === 'systemNotification') {
			const lastResponsePart = this._responseParts.at(-1);
			if (lastResponsePart?.kind === 'toolInvocation' && IChatToolInvocation.isStreaming(lastResponsePart) && !IChatToolInvocation.isEffectivelyHidden(lastResponsePart)) {
				this._responseParts.splice(this._responseParts.length - 1, 0, progress);
			} else {
				this._responseParts.push(progress);
			}
			this._contentChanged(quiet);
		} else if (progress.kind === 'thinking') {

			const lastResponsePart = this._responseParts
				.filter(p => p.kind !== 'textEditGroup')
				.at(-1);

			const lastText = lastResponsePart && lastResponsePart.kind === 'thinking'
				? (Array.isArray(lastResponsePart.value) ? lastResponsePart.value.join('') : (lastResponsePart.value || ''))
				: '';
			const currText = Array.isArray(progress.value) ? progress.value.join('') : (progress.value || '');
			const isEmpty = (s: string) => s.length === 0;
			if (isEmpty(currText)) {
				this.finalizeReasoningDuration();
			} else if (!this._activeReasoning) {
				this._activeReasoning = { part: progress, startedAt: Date.now() };
			}

			if (!lastResponsePart
				|| lastResponsePart.kind !== 'thinking'
				|| isEmpty(currText)
				|| isEmpty(lastText)
				|| !canMergeMarkdownStrings(new MarkdownString(lastText), new MarkdownString(currText))) {
				this._responseParts.push(progress);
			} else {
				const idx = this._responseParts.indexOf(lastResponsePart);
				const mergedPart: IChatThinkingPart = {
					...lastResponsePart,
					value: appendMarkdownString(new MarkdownString(lastText), new MarkdownString(currText)).value
				};
				this._responseParts[idx] = mergedPart;
				if (this._activeReasoning?.part === lastResponsePart) {
					this._activeReasoning.part = mergedPart;
				}
			}
			this._contentChanged(quiet);
		} else if (progress.kind === 'textEdit' || progress.kind === 'notebookEdit') {
			const notebookUri = CellUri.parse(progress.uri)?.notebook;
			const uri = notebookUri ?? progress.uri;
			const isExternalEdit = progress.isExternalEdit;

			if (progress.kind === 'textEdit' && !notebookUri) {
				this._mergeOrPushTextEditGroup(uri, progress.edits, progress.done, isExternalEdit);
			} else if (progress.kind === 'textEdit') {
				const cellEdits = progress.edits.map(edit => ({ uri: progress.uri, edit }));
				this._mergeOrPushNotebookEditGroup(uri, cellEdits, progress.done, isExternalEdit);
			} else {
				this._mergeOrPushNotebookEditGroup(uri, progress.edits, progress.done, isExternalEdit);
			}
			this._contentChanged(quiet);
		} else if (progress.kind === 'progressTask') {
			const responsePosition = this._responseParts.push(progress) - 1;
			this._contentChanged(quiet);

			const disp = progress.onDidAddProgress(() => {
				this._contentChanged(false);
			});

			progress.task?.().then((content) => {
				disp.dispose();

				if (typeof content === 'string') {
					(this._responseParts[responsePosition] as IChatTask).content = new MarkdownString(content);
				}
				this._contentChanged(false);
			});

		} else if (progress.kind === 'toolInvocation') {
			registerAutorunSelfDisposable(this._store, reader => {
				progress.state.read(reader);
				this._contentChanged(false);

				if (IChatToolInvocation.isComplete(progress, reader)) {
					reader.dispose();
				}
			});
			this._responseParts.push(progress);
			this._contentChanged(quiet);
		} else if (progress.kind === 'externalToolInvocationUpdate') {
			this._handleExternalToolInvocationUpdate(progress);
			this._contentChanged(quiet);
		} else if (progress.kind === 'progressMessage' && progress.id !== undefined) {
			const idx = this._responseParts.findIndex(p => p.kind === 'progressMessage' && p.id === progress.id);
			if (idx === -1) {
				this._responseParts.push(progress);
			} else {
				this._responseParts[idx] = progress;
			}
			this._contentChanged(quiet);
		} else if (progress.kind === 'autoModeResolution') {
			const idx = this._responseParts.findIndex(p => p.kind === 'autoModeResolution' && !p.resolved);
			if (idx === -1) {
				this._responseParts.push(progress);
			} else {
				this._responseParts[idx] = progress;
			}
			this._contentChanged(quiet);
		} else {
			this._responseParts.push(progress);
			this._contentChanged(quiet);
		}
	}

	finalizeReasoningDuration(): void {
		if (!this._activeReasoning) {
			return;
		}

		this._activeReasoning.part.reasoningDurationMs = Math.max(0, Date.now() - this._activeReasoning.startedAt);
		this._activeReasoning = undefined;
	}

	public addCitation(citation: IChatCodeCitation) {
		this._citations.push(citation);
		this._contentChanged();
	}

	public resolveInlineReference(resolveId: string, resolvedReference: IChatContentInlineReference): boolean {
		for (let i = 0; i < this._responseParts.length; i++) {
			const current = this._responseParts[i];
			if (current.kind !== 'inlineReference' || current.resolveId !== resolveId) {
				continue;
			}

			this._responseParts[i] = {
				...current,
				inlineReference: resolvedReference.inlineReference,
				name: resolvedReference.name ?? current.name,
			};
			this._contentChanged();
			return true;
		}

		return false;
	}

	private _mergeOrPushTextEditGroup(uri: URI, edits: TextEdit[], done: boolean | undefined, isExternalEdit: boolean | undefined): void {
		for (const candidate of this._responseParts) {
			if (candidate.kind === 'textEditGroup' && !candidate.done && isEqual(candidate.uri, uri)) {
				candidate.edits.push(edits);
				candidate.done = done;
				return;
			}
		}
		this._responseParts.push({ kind: 'textEditGroup', uri, edits: [edits], done, isExternalEdit });
	}

	private _mergeOrPushNotebookEditGroup(uri: URI, edits: ICellTextEditOperation[] | ICellEditOperation[], done: boolean | undefined, isExternalEdit: boolean | undefined): void {
		for (const candidate of this._responseParts) {
			if (candidate.kind === 'notebookEditGroup' && !candidate.done && isEqual(candidate.uri, uri)) {
				candidate.edits.push(edits);
				candidate.done = done;
				return;
			}
		}
		this._responseParts.push({ kind: 'notebookEditGroup', uri, edits: [edits], done, isExternalEdit });
	}

	private _handleExternalToolInvocationUpdate(progress: IChatExternalToolInvocationUpdate): void {
		const existingInvocation = this._responseParts.findLast(
			(part): part is ChatToolInvocation => part.kind === 'toolInvocation' && part.toolCallId === progress.toolCallId
		);

		if (existingInvocation) {
			if (progress.toolSpecificData !== undefined) {
				existingInvocation.toolSpecificData = progress.toolSpecificData;
			}
			if (progress.isComplete) {
				existingInvocation.didExecuteTool({
					content: [],
					toolResultMessage: progress.pastTenseMessage,
					toolResultError: progress.errorMessage,
					toolResultDetails: progress.resultDetails
				});
			}
			return;
		}

		const toolData: IToolData = {
			id: progress.toolName,
			source: ToolDataSource.External,
			displayName: progress.toolName,
			modelDescription: progress.toolName,
		};

		const invocation = new ChatToolInvocation(
			{
				invocationMessage: progress.invocationMessage,
				pastTenseMessage: progress.pastTenseMessage,
				toolSpecificData: progress.toolSpecificData,
			},
			toolData,
			progress.toolCallId,
			progress.subagentInvocationId,
			undefined,
			{},
			undefined
		);

		if (progress.isComplete) {
			if (progress.toolSpecificData !== undefined) {
				invocation.toolSpecificData = progress.toolSpecificData;
			}
			invocation.didExecuteTool({
				content: [],
				toolResultMessage: progress.pastTenseMessage,
				toolResultError: progress.errorMessage,
				toolResultDetails: progress.resultDetails
			});
		}

		this._responseParts.push(invocation);
	}

	protected override computeRepr(): string {
		let repr = super.computeRepr();
		if (this._citations.length) {
			repr += '\n\n' + getCodeCitationsMessage(this._citations);
		}
		return repr;
	}

	private _contentChanged(quiet?: boolean) {
		this._invalidateRepr();
		if (!quiet) {
			this._onDidChangeValue.fire();
		}
	}
}

export interface IChatResponseModelParameters {
	responseContent: IMarkdownString | ReadonlyArray<SerializedChatResponsePart>;
	session: ChatModel;
	agent?: IChatAgentData;
	slashCommand?: IChatAgentCommand;
	requestId: string;
	timestamp?: number;
	vote?: ChatAgentVoteDirection;
	result?: IChatAgentResult;
	followups?: ReadonlyArray<IChatFollowup>;
	isCompleteAddedRequest?: boolean;
	shouldBeRemovedOnSend?: IChatRequestDisablement;
	shouldBeBlocked?: boolean;
	restoredId?: string;
	modelState?: ResponseModelStateT;
	completionTimestamp?: number | null;
	timeSpentWaiting?: number;
	elapsedMs?: number;
	codeBlockInfos: ICodeBlockInfo[] | undefined;
}

export type ResponseModelStateT =
	| { value: ResponseModelState.Pending }
	| { value: ResponseModelState.NeedsInput }
	| { value: ResponseModelState.Complete | ResponseModelState.Cancelled | ResponseModelState.Failed; completedAt: number };

function sumModelOutputTokens(modelTotals: readonly IChatUsageModelTotal[] | undefined): number | undefined {
	return modelTotals?.reduce((total, entry) => total + entry.outputTokens, 0);
}

export class ChatResponseModel extends Disposable implements IChatResponseModel {
	private readonly _onDidChange = this._register(new Emitter<ChatResponseModelChangeReason>());
	readonly onDidChange = this._onDidChange.event;

	public readonly id: string;
	public readonly requestId: string;
	private _session: ChatModel;
	private _agent: IChatAgentData | undefined;
	private _slashCommand: IChatAgentCommand | undefined;
	private _modelState = observableValue<ResponseModelStateT>(this, { value: ResponseModelState.Pending });
	private _vote?: ChatAgentVoteDirection;
	private _result?: IChatAgentResult;
	private readonly _usageObs = observableValue<IChatUsage | undefined>(this, undefined);
	private _parentUsage: IChatUsage | undefined;
	private readonly _subagentCopilotCredits = new Map<string, number>();
	private readonly _completionTokenCountObs = observableValue<number | undefined>(this, undefined);
	private _shouldBeRemovedOnSend: IChatRequestDisablement | undefined;
	public readonly isCompleteAddedRequest: boolean;
	private readonly _shouldBeBlocked = observableValue<boolean>(this, false);
	private readonly _timestamp: number;
	private _completionTimestamp: number | undefined;
	private _timeSpentWaitingAccumulator: number;
	private _elapsedMs: number | undefined;
	private readonly _timingChanged = observableSignal(this);

	public confirmationAdjustedTimestamp: IObservable<number>;

	public get shouldBeBlocked(): IObservable<boolean> {
		return this._shouldBeBlocked;
	}

	public get request(): IChatRequestModel | undefined {
		return this.session.getRequests().find(r => r.id === this.requestId);
	}

	public get session() {
		return this._session;
	}

	public get shouldBeRemovedOnSend() {
		return this._shouldBeRemovedOnSend;
	}

	public get isHiddenFromTranscript(): boolean {
		return this.request?.isHiddenFromTranscript ?? false;
	}

	public get isComplete(): boolean {
		return this._modelState.get().value !== ResponseModelState.Pending && this._modelState.get().value !== ResponseModelState.NeedsInput;
	}

	public get timestamp(): number {
		return this._timestamp;
	}

	public set shouldBeRemovedOnSend(disablement: IChatRequestDisablement | undefined) {
		if (this._shouldBeRemovedOnSend === disablement) {
			return;
		}

		this._shouldBeRemovedOnSend = disablement;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	public get isCanceled(): boolean {
		return this._modelState.get().value === ResponseModelState.Cancelled;
	}

	public get completedAt(): number | undefined {
		const state = this._modelState.get();
		if (state.value === ResponseModelState.Complete || state.value === ResponseModelState.Cancelled || state.value === ResponseModelState.Failed) {
			return state.completedAt;
		}
		return undefined;
	}

	public get completionTimestamp(): number | undefined {
		return this._completionTimestamp;
	}

	public get state(): ResponseModelState {
		const state = this._modelState.get().value;
		if (state === ResponseModelState.Complete && !!this._result?.errorDetails && this.result?.errorDetails?.code !== 'canceled') {
			return ResponseModelState.Failed;
		}

		return state;
	}

	public get stateT(): ResponseModelStateT {
		return this._modelState.get();
	}

	public get vote(): ChatAgentVoteDirection | undefined {
		return this._vote;
	}

	public get followups(): IChatFollowup[] | undefined {
		return this._followups;
	}

	private _response: Response;
	private _finalizedResponse?: IResponse;
	public get entireResponse(): IResponse {
		return this._finalizedResponse || this._response;
	}

	public get result(): IChatAgentResult | undefined {
		return this._result;
	}

	public get usage(): IChatUsage | undefined {
		return this._usageObs.get();
	}

	public get usageObs(): IObservable<IChatUsage | undefined> {
		return this._usageObs;
	}

	public get completionTokenCount(): number | undefined {
		return this._completionTokenCountObs.get();
	}

	public get completionTokenCountObs(): IObservable<number | undefined> {
		return this._completionTokenCountObs;
	}

	public get elapsedMs(): number | undefined {
		return this._elapsedMs;
	}

	public get username(): string {
		return this.session.responderUsername;
	}

	private _followups?: IChatFollowup[];

	public get agent(): IChatAgentData | undefined {
		return this._agent;
	}

	public get slashCommand(): IChatAgentCommand | undefined {
		return this._slashCommand;
	}

	private _agentOrSlashCommandDetected: boolean | undefined;
	public get agentOrSlashCommandDetected(): boolean {
		return this._agentOrSlashCommandDetected ?? false;
	}

	private _usedContext: IChatUsedContext | undefined;
	public get usedContext(): IChatUsedContext | undefined {
		return this._usedContext;
	}

	private readonly _contentReferences: IChatContentReference[] = [];
	public get contentReferences(): ReadonlyArray<IChatContentReference> {
		return Array.from(this._contentReferences);
	}

	private readonly _codeCitations: IChatCodeCitation[] = [];
	public get codeCitations(): ReadonlyArray<IChatCodeCitation> {
		return this._codeCitations;
	}

	private readonly _progressMessages: IChatProgressMessage[] = [];
	public get progressMessages(): ReadonlyArray<IChatProgressMessage> {
		return this._progressMessages;
	}

	private _isStale: boolean = false;
	public get isStale(): boolean {
		return this._isStale;
	}


	readonly isPendingConfirmation: IObservable<{ startedWaitingAt: number; detail?: string } | undefined>;

	readonly isInProgress: IObservable<boolean>;

	readonly isIncomplete: IObservable<boolean>;

	private _responseView?: ResponseView;
	public get response(): IResponse {
		const undoStop = this._shouldBeRemovedOnSend?.afterUndoStop;
		if (!undoStop) {
			return this._finalizedResponse || this._response;
		}

		if (this._responseView?.undoStop !== undoStop) {
			this._responseView = new ResponseView(this._response, undoStop);
		}

		return this._responseView;
	}

	private _codeBlockInfos: ICodeBlockInfo[] | undefined;
	public get codeBlockInfos(): ICodeBlockInfo[] | undefined {
		return this._codeBlockInfos;
	}

	constructor(params: IChatResponseModelParameters) {
		super();

		this._session = params.session;
		this._agent = params.agent;
		this._slashCommand = params.slashCommand;
		this.requestId = params.requestId;
		this._timestamp = params.timestamp || Date.now();
		if (params.modelState) {
			this._modelState.set(params.modelState, undefined);
		}
		this._completionTimestamp = params.completionTimestamp === null
			? undefined
			: params.completionTimestamp ?? (params.modelState && 'completedAt' in params.modelState ? params.modelState.completedAt : undefined);
		this._timeSpentWaitingAccumulator = params.timeSpentWaiting || 0;
		this._elapsedMs = params.elapsedMs;
		this._vote = params.vote;
		this._result = params.result;
		this._followups = params.followups ? [...params.followups] : undefined;
		this.isCompleteAddedRequest = params.isCompleteAddedRequest ?? false;
		this._shouldBeRemovedOnSend = params.shouldBeRemovedOnSend;
		this._shouldBeBlocked.set(params.shouldBeBlocked ?? false, undefined);

		this._isStale = Array.isArray(params.responseContent) && (params.responseContent.length !== 0 || isMarkdownString(params.responseContent) && params.responseContent.value.length !== 0);

		this._response = this._register(new Response(params.responseContent));
		this._codeBlockInfos = params.codeBlockInfos ? [...params.codeBlockInfos] : undefined;

		const signal = observableSignalFromEvent(this, this.onDidChange);

		const _pendingInfo = signal.map((_value, r): string | undefined => {
			signal.read(r);

			for (const part of this._response.value) {
				if (part.kind === 'toolInvocation') {
					const state = part.state.read(r);
					if (state.type === IChatToolInvocation.StateKind.WaitingForConfirmation) {
						const title = state.confirmationMessages?.title;
						return title ? (isMarkdownString(title) ? title.value : title) : undefined;
					}
					if (state.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
						return localize('waitingForPostApproval', "Approve tool result?");
					}
					if (state.type === IChatToolInvocation.StateKind.WaitingForAuthentication) {
						return localize('waitingForToolAuthentication', "Authenticate {0} to continue...", state.server.name);
					}
				}
				if (part.kind === 'confirmation' && !part.isUsed) {
					return part.title;
				}
				if (part.kind === 'questionCarousel' && !part.isUsed) {
					return localize('waitingAnswer', "Answer questions to continue...");
				}
				if (part.kind === 'planReview' && !part.isUsed) {
					return localize('waitingPlanReview', "Review the plan to continue...");
				}
				if (part.kind === 'elicitation2' && part.state.read(r) === ElicitationState.Pending) {
					const title = part.title;
					return isMarkdownString(title) ? title.value : title;
				}
			}

			return undefined;
		});

		const _startedWaitingAt = _pendingInfo.map(p => !!p).map(p => p ? Date.now() : undefined);
		this.isPendingConfirmation = _startedWaitingAt.map((waiting, r) => waiting ? { startedWaitingAt: waiting, detail: _pendingInfo.read(r) } : undefined);

		this.isInProgress = signal.map((_value, r) => {

			signal.read(r);

			return !_pendingInfo.read(r)
				&& !this.shouldBeRemovedOnSend
				&& (this._modelState.read(r).value === ResponseModelState.Pending || this._modelState.read(r).value === ResponseModelState.NeedsInput);
		});

		this.isIncomplete = this._modelState.map(state => {
			return state.value === ResponseModelState.Pending || state.value === ResponseModelState.NeedsInput;
		});

		this._register(this._response.onDidChangeValue(() => this._onDidChange.fire(defaultChatResponseModelChangeReason)));
		this.id = params.restoredId ?? 'response_' + generateUuid();

		let lastStartedWaitingAt: number | undefined = undefined;
		this.confirmationAdjustedTimestamp = derived(reader => {
			this._timingChanged.read(reader);
			const pending = this.isPendingConfirmation.read(reader);
			if (pending) {
				this._modelState.set({ value: ResponseModelState.NeedsInput }, undefined);
				if (!lastStartedWaitingAt) {
					lastStartedWaitingAt = pending.startedWaitingAt;
				}
			} else if (lastStartedWaitingAt) {
				if (this._modelState.read(reader).value === ResponseModelState.NeedsInput) {
					this._modelState.set({ value: ResponseModelState.Pending }, undefined);
				}
				this._timeSpentWaitingAccumulator += Date.now() - lastStartedWaitingAt;
				lastStartedWaitingAt = undefined;
			}

			return this._timestamp + this._timeSpentWaitingAccumulator;
		}).recomputeInitiallyAndOnChange(this._store);
	}

	initializeCodeBlockInfos(codeBlockInfo: ICodeBlockInfo[]): void {
		if (this._codeBlockInfos) {
			throw new BugIndicatingError('Code block infos have already been initialized');
		}
		this._codeBlockInfos = [...codeBlockInfo];
	}

	setBlockedState(isBlocked: boolean): void {
		this._shouldBeBlocked.set(isBlocked, undefined);
	}

	updateContent(responsePart: IChatProgressResponseContent | IChatTextEdit | IChatNotebookEdit | IChatExternalToolInvocationUpdate, quiet?: boolean) {
		this._response.updateContent(responsePart, quiet);
	}

	resolveInlineReference(resolveId: string, resolvedReference: IChatContentInlineReference): boolean {
		return this._response.resolveInlineReference(resolveId, resolvedReference);
	}

	addUndoStop(undoStop: IChatUndoStop) {
		this._onDidChange.fire({ reason: 'undoStop', id: undoStop.id });
		this._response.updateContent(undoStop, true);
	}

	applyReference(progress: IChatUsedContext | IChatContentReference) {
		if (progress.kind === 'usedContext') {
			this._usedContext = progress;
		} else if (progress.kind === 'reference') {
			this._contentReferences.push(progress);
			this._onDidChange.fire(defaultChatResponseModelChangeReason);
		}
	}

	applyCodeCitation(progress: IChatCodeCitation) {
		this._codeCitations.push(progress);
		this._response.addCitation(progress);
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setAgent(agent: IChatAgentData, slashCommand?: IChatAgentCommand) {
		this._agent = agent;
		this._slashCommand = slashCommand;
		this._agentOrSlashCommandDetected = !agent.isDefault || !!slashCommand;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setResult(result: IChatAgentResult): void {
		if (this.isCanceled && result.errorDetails) {
			const { errorDetails: _errorDetails, ...rest } = result;
			this._result = rest;
		} else {
			this._result = result;
		}
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setUsage(usage: IChatUsage): void {
		this._parentUsage = usage;
		this._setUsage(this._withSubagentCopilotCredits(usage), true);
	}

	setSubagentCopilotCredits(subagentCallId: string, copilotCredits: number): void {
		const currentCredits = this._subagentCopilotCredits.get(subagentCallId);
		if (!Number.isFinite(copilotCredits) || copilotCredits < 0 || (currentCredits !== undefined && copilotCredits <= currentCredits)) {
			return;
		}
		this._subagentCopilotCredits.set(subagentCallId, copilotCredits);
		const usage = this._parentUsage ?? { kind: 'usage', promptTokens: 0, completionTokens: 0 };
		this._setUsage(this._withSubagentCopilotCredits(usage), false);
	}

	private _withSubagentCopilotCredits(usage: IChatUsage): IChatUsage {
		let subagentCopilotCredits = 0;
		for (const credits of this._subagentCopilotCredits.values()) {
			subagentCopilotCredits += credits;
		}
		return subagentCopilotCredits === 0
			? usage
			: { ...usage, copilotCredits: (usage.copilotCredits ?? 0) + subagentCopilotCredits };
	}

	private _setUsage(usage: IChatUsage, countCompletionTokens: boolean): void {
		const currentUsage = this._usageObs.get();
		if (currentUsage && this.isSameUsage(currentUsage, usage)) {
			return;
		}

		const isNewCall = !currentUsage
			|| currentUsage.promptTokens !== usage.promptTokens
			|| currentUsage.completionTokens !== usage.completionTokens
			|| currentUsage.outputBuffer !== usage.outputBuffer;

		this._usageObs.set(usage, undefined);
		const reportedOutputTokens = sumModelOutputTokens(usage.modelTotals);
		if (reportedOutputTokens !== undefined) {
			this._completionTokenCountObs.set(reportedOutputTokens, undefined);
		} else if (countCompletionTokens && isNewCall) {
			const previousCompletionTokens = this._completionTokenCountObs.get() ?? 0;
			this._completionTokenCountObs.set(previousCompletionTokens + usage.completionTokens, undefined);
		}
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setElapsedMs(elapsedMs: number): void {
		this._elapsedMs = Math.max(0, elapsedMs);
	}

	private isSameUsage(currentUsage: IChatUsage, usage: IChatUsage): boolean {
		return currentUsage.promptTokens === usage.promptTokens
			&& currentUsage.completionTokens === usage.completionTokens
			&& currentUsage.outputBuffer === usage.outputBuffer
			&& currentUsage.copilotCredits === usage.copilotCredits
			&& currentUsage.sessionCopilotCredits === usage.sessionCopilotCredits
			&& equals(currentUsage.promptTokenDetails, usage.promptTokenDetails)
			&& equals(currentUsage.modelTotals, usage.modelTotals);
	}

	complete(completedAt = Date.now()): void {
		this._complete(completedAt, completedAt);
	}

	completeWithoutTimestamp(): void {
		this._complete(Date.now(), undefined);
	}

	reopen(): void {
		if (!this.isComplete) {
			return;
		}
		this._response.clear();
		if (this._result?.errorDetails) {
			const { errorDetails: _errorDetails, ...result } = this._result;
			this._result = result;
		}
		if (this.completedAt !== undefined) {
			this._timeSpentWaitingAccumulator += Math.max(0, Date.now() - this.completedAt);
			this._timingChanged.trigger(undefined);
		}
		this._completionTimestamp = undefined;
		this._elapsedMs = undefined;
		this._modelState.set({ value: ResponseModelState.Pending }, undefined);
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	private _complete(completedAt: number, completionTimestamp: number | undefined): void {
		if (this.isComplete) {
			return;
		}
		if (this._result?.errorDetails?.responseIsRedacted) {
			this._response.clear();
		}
		this._response.finalizeReasoningDuration();

		this._elapsedMs ??= Math.max(0, completedAt - this.confirmationAdjustedTimestamp.get());

		const state = !!this._result?.errorDetails && this._result.errorDetails.code !== 'canceled' ? ResponseModelState.Failed : ResponseModelState.Complete;
		this._completionTimestamp = completionTimestamp;
		this._modelState.set({ value: state, completedAt }, undefined);
		this._onDidChange.fire({ reason: 'completedRequest' });
	}

	cancel(): void {
		this._response.finalizeReasoningDuration();
		for (const part of this._response.value) {
			if (part.kind === 'toolInvocation' && part instanceof ChatToolInvocation) {
				part.cancelFromStreaming(ToolConfirmKind.Skipped);
			} else if (part instanceof ChatPlanReviewData) {
				part.dismiss();
			} else if (part instanceof ChatQuestionCarouselData) {
				part.dismiss(undefined);
			}
		}

		const completedAt = Date.now();
		this._elapsedMs ??= Math.max(0, completedAt - this.confirmationAdjustedTimestamp.get());
		this._completionTimestamp = completedAt;
		this._modelState.set({ value: ResponseModelState.Cancelled, completedAt }, undefined);
		this._onDidChange.fire({ reason: 'completedRequest' });
	}

	setFollowups(followups: IChatFollowup[] | undefined): void {
		this._followups = followups;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setVote(vote: ChatAgentVoteDirection): void {
		this._vote = vote;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}

	setEditApplied(edit: IChatTextEditGroup, editCount: number): boolean {
		if (!this.response.value.includes(edit)) {
			return false;
		}
		if (!edit.state) {
			return false;
		}
		edit.state.applied = editCount;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
		return true;
	}

	adoptTo(session: ChatModel) {
		this._session = session;
		this._onDidChange.fire(defaultChatResponseModelChangeReason);
	}


	finalizeUndoState(): void {
		this._finalizedResponse = this.response;
		this._responseView = undefined;
		this._shouldBeRemovedOnSend = undefined;
	}

	override dispose(): void {
		super.dispose();
		this._response.clear();
		if (this._codeBlockInfos) {
			this._codeBlockInfos.length = 0;
		}
	}

	toJSON(): Omit<ISerializableChatResponseData, 'timestamp'> {
		const modelState = this._modelState.get();
		const pendingConfirmation = this.isPendingConfirmation.get();

		return {
			responseId: this.id,
			result: this.result,
			responseMarkdownInfo: this.codeBlockInfos?.map<ISerializableMarkdownInfo>(info => ({ suggestionId: info.suggestionId })),
			followups: this.followups,
			modelState: modelState.value === ResponseModelState.Pending || modelState.value === ResponseModelState.NeedsInput ? { value: ResponseModelState.Cancelled, completedAt: Date.now() } : modelState,
			vote: this.vote,
			slashCommand: this.slashCommand,
			usedContext: this.usedContext,
			contentReferences: this.contentReferences,
			codeCitations: this.codeCitations,
			responseTimestamp: this._timestamp,
			timeSpentWaiting: (pendingConfirmation ? Date.now() - pendingConfirmation.startedWaitingAt : 0) + this._timeSpentWaitingAccumulator,
			promptTokens: this.usage?.promptTokens,
			completionTokens: this.completionTokenCount,
			outputBuffer: this.usage?.outputBuffer,
			promptTokenDetails: this.usage?.promptTokenDetails,
			copilotCredits: this.usage?.copilotCredits,
			modelTotals: this.usage?.modelTotals,
			sessionCopilotCredits: this.usage?.sessionCopilotCredits,
			elapsedMs: this.elapsedMs ?? (this.completedAt ? Math.max(0, this.completedAt - this.confirmationAdjustedTimestamp.get()) : undefined),
		} satisfies WithDefinedProps<Omit<ISerializableChatResponseData, 'timestamp'>>;
	}
}


export interface IChatRequestDisablement {
	requestId: string;
	afterUndoStop?: string;
}

export interface IChatRequestNeedsInputInfo {
	readonly title: string;
	readonly detail?: string;
}

export interface IChatModel extends IDisposable {
	readonly onDidDispose: Event<void>;
	readonly onDidChange: Event<IChatChangeEvent>;

	readonly sessionResource: URI;
	readonly sessionId: string;

	readonly timestamp: number;
	readonly lastMessageDate: number;
	readonly timing: IChatSessionTiming;
	readonly initialLocation: ChatAgentLocation;
	readonly sessionTypeSelectionReason: SessionTypeSelectionReason | undefined;
	readonly title: string;
	readonly hasCustomTitle: boolean;
	readonly responderUsername: string;
	readonly requestInProgress: IObservable<boolean>;
	readonly hasActiveRequest: IObservable<boolean>;
	readonly requestNeedsInput: IObservable<IChatRequestNeedsInputInfo | undefined>;
	readonly isReadOnly: IObservable<boolean>;
	readonly inputPlaceholder?: string;
	readonly editingSession?: IChatEditingSession | undefined;
	readonly checkpoint: IChatRequestModel | undefined;
	startEditingSession(isGlobalEditingSession?: boolean, transferFromSession?: IChatEditingSession): void;
	readonly inputModel: IInputModel;
	readonly hasRequests: boolean;
	readonly lastRequest: IChatRequestModel | undefined;
	readonly willKeepAlive: boolean;
	readonly lastRequestObs: IObservable<IChatRequestModel | undefined>;
	readonly sessionCost: number;
	getRequests(): IChatRequestModel[];
	setCheckpoint(requestId: string | undefined): void;

	toExport(): IExportableChatData;
	toJSON(): ISerializableChatData;

	readonly repoData: IExportableRepoData | undefined;
	setRepoData(data: IExportableRepoData | undefined): void;

	readonly workingDirectory: URI | undefined;
	setWorkingDirectory(uri: URI | undefined): void;

	readonly onDidChangePendingRequests: Event<void>;
	getPendingRequests(): readonly IChatPendingRequest[];
}

export interface ISerializableChatsData {
	[sessionId: string]: ISerializableChatData;
}

export type ISerializableChatAgentData = UriDto<IChatAgentData>;

interface ISerializableChatResponseData {
	responseId?: string;
	result?: IChatAgentResult;
	responseMarkdownInfo?: ISerializableMarkdownInfo[];
	followups?: ReadonlyArray<IChatFollowup>;
	modelState?: ResponseModelStateT;
	vote?: ChatAgentVoteDirection;
	timestamp?: number;
	responseTimestamp?: number;
	slashCommand?: IChatAgentCommand;
	usedContext?: IChatUsedContext;
	contentReferences?: ReadonlyArray<IChatContentReference>;
	codeCitations?: ReadonlyArray<IChatCodeCitation>;
	timeSpentWaiting?: number;
	promptTokens?: number;
	completionTokens?: number;
	outputBuffer?: number;
	promptTokenDetails?: readonly IChatUsagePromptTokenDetail[];
	copilotCredits?: number;
	modelTotals?: readonly IChatUsageModelTotal[];
	sessionCopilotCredits?: number;
	elapsedMs?: number;
}

export type SerializedChatResponsePart = IMarkdownString | IChatResponseProgressFileTreeData | IChatContentInlineReference | IChatAgentMarkdownContentWithVulnerability | IChatThinkingPart | IChatProgressResponseContentSerialized | IChatQuestionCarousel | IChatPlanReview | IChatDisabledClaudeHooksPart;

export interface ISerializableChatRequestData extends ISerializableChatResponseData {
	requestId: string;
	message: string | IParsedChatRequest;
	variableData: IChatRequestVariableData;
	response: ReadonlyArray<SerializedChatResponsePart> | undefined;

	isHidden?: boolean;
	hiddenFromTranscript?: boolean;
	requestHiddenFromTranscript?: boolean;
	shouldBeRemovedOnSend?: IChatRequestDisablement;
	agent?: ISerializableChatAgentData;
	isCanceled?: boolean;
	timestamp?: number;
	confirmation?: string;
	editedFileEvents?: IChatAgentEditedFileEvent[];
	modelId?: string;
	modeInfo?: IChatRequestModeInfo;
	isSystemInitiated?: boolean;
	systemInitiatedLabel?: string;
	terminalExecutionId?: string;
	origin?: ISerializableChatRequestOrigin;
}

export interface ISerializableMarkdownInfo {
	readonly suggestionId: EditSuggestionId;
}

export interface IExportableRepoData {
	workspaceType: 'remote-git' | 'local-git' | 'plain-folder';

	syncStatus: 'synced' | 'unpushed' | 'unpublished' | 'local-only' | 'no-git';

	remoteUrl?: string;

	remoteVendor?: 'github' | 'ado' | 'other';

	remoteTrackingBranch?: string;

	remoteBaseBranch?: string;

	remoteHeadCommit?: string;

	localBranch?: string;

	localHeadCommit?: string;

	diffs?: IExportableRepoDiff[];

	diffsStatus?: 'included' | 'tooManyChanges' | 'tooLarge' | 'trimmedForStorage' | 'noChanges' | 'notCaptured';

	changedFileCount?: number;
}




export interface IExportableRepoDiff {
	relativePath: string;
	changeType: 'added' | 'modified' | 'deleted' | 'renamed';
	oldRelativePath?: string;
	unifiedDiff?: string;
	status: string;
}

export interface IExportableChatData {
	initialLocation: ChatAgentLocation | undefined;
	requests: ISerializableChatRequestData[];
	responderUsername: string;
}


export interface ISerializableChatData1 extends IExportableChatData {
	sessionId: string;
	creationDate: number;
}

export interface ISerializableChatData2 extends ISerializableChatData1 {
	version: 2;
	computedTitle: string | undefined;
}

export interface ISerializableChatData3 extends Omit<ISerializableChatData2, 'version' | 'computedTitle'> {
	version: 3;
	customTitle: string | undefined;
	hasPendingEdits?: boolean;
	inputState?: ISerializableChatModelInputState;
	repoData?: IExportableRepoData;
	pendingRequests?: ISerializablePendingRequestData[];
	workingDirectory?: string;
}

export interface IIntendedModelHolder {
	readonly intendedModel: IIntendedModelSelection | undefined;

	setIntendedModel(selection: IIntendedModelSelection | undefined): void;
}

export class IntendedModelSlot implements IIntendedModelHolder {
	intendedModel: IIntendedModelSelection | undefined;

	setIntendedModel(selection: IIntendedModelSelection | undefined): void {
		this.intendedModel = selection;
	}
}

export interface IInputModel extends IIntendedModelHolder {
	readonly state: IObservable<IChatModelInputState | undefined>;

	setState(state: Partial<IChatModelInputState>): void;

	clearState(): void;

	toJSON(): ISerializableChatModelInputState | undefined;
}

export const enum ChatInputStateOrigin {
	Remote = 'remote',
}

export interface IChatModelInputState {
	attachments: readonly IChatRequestVariableEntry[];

	mode: {
		id: string;
		kind: ChatModeKind | undefined;
	};

	selectedModel: ILanguageModelChatMetadataAndIdentifier | undefined;

	modelConfiguration?: IStringDictionary<unknown>;

	selectedModelReason?: ModelSelectionReason;

	inputText: string;

	selections: ISelection[];

	permissionLevel?: ChatPermissionLevel;

	origin?: ChatInputStateOrigin;

	contrib: Record<string, unknown>;
}

export interface ISerializableChatModelInputState {
	attachments: readonly IChatRequestVariableEntry[];
	mode: {
		id: string;
		kind: ChatModeKind | undefined;
	};
	selectedModel: {
		identifier: string;
		metadata: ILanguageModelChatMetadata;
		modelConfiguration?: IStringDictionary<unknown>;
	} | undefined;
	inputText: string;
	selections: ISelection[];
	permissionLevel?: ChatPermissionLevel;
	contrib: Record<string, unknown>;
}

interface ILegacySerializableChatModelInputState extends ISerializableChatModelInputState {
	modelConfiguration?: IStringDictionary<unknown>;
}

export function reviveSerializableInputState(state: ISerializableChatModelInputState): IChatModelInputState {
	return {
		attachments: (state.attachments ?? []).map(IChatRequestVariableEntry.fromExport),
		mode: state.mode,
		selectedModel: state.selectedModel && {
			identifier: state.selectedModel.identifier,
			metadata: state.selectedModel.metadata
		},
		modelConfiguration: state.selectedModel ? (state.selectedModel.modelConfiguration ?? (state as ILegacySerializableChatModelInputState).modelConfiguration) : undefined,
		contrib: state.contrib,
		inputText: state.inputText,
		selections: state.selections,
		permissionLevel: state.permissionLevel,
	};
}

export type ISerializableChatData = ISerializableChatData3;

export type IChatDataSerializerLog = ObjectMutationLog<IChatModel, ISerializableChatData>;

export interface ISerializedChatDataReference {
	value: ISerializableChatData | IExportableChatData;
	serializer: IChatDataSerializerLog;
}

export type ISerializableChatDataIn = ISerializableChatData1 | ISerializableChatData2 | ISerializableChatData3;

export function normalizeSerializableChatData(raw: ISerializableChatDataIn): ISerializableChatData {
	normalizeOldFields(raw);

	if (!('version' in raw)) {
		return {
			version: 3,
			...raw,
			customTitle: undefined,
		};
	}

	if (raw.version === 2) {
		return {
			...raw,
			version: 3,
			customTitle: raw.computedTitle
		};
	}

	return raw;
}

function normalizeOldFields(raw: ISerializableChatDataIn): void {
	if (!raw.sessionId) {
		raw.sessionId = generateUuid();
	}

	if (!raw.creationDate) {
		raw.creationDate = getLastYearDate();
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any, local/code-no-any-casts
	if ((raw.initialLocation as any) === 'editing-session') {
		raw.initialLocation = ChatAgentLocation.Chat;
	}
}

function getLastYearDate(): number {
	const lastYearDate = new Date();
	lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
	return lastYearDate.getTime();
}

export function isExportableSessionData(obj: unknown): obj is IExportableChatData {
	return !!obj &&
		Array.isArray((obj as IExportableChatData).requests) &&
		typeof (obj as IExportableChatData).responderUsername === 'string';
}

export function extractExportableSessionData(data: IExportableChatData): IExportableChatData {
	return {
		initialLocation: data.initialLocation,
		requests: data.requests,
		responderUsername: data.responderUsername,
	};
}

export function isSerializableSessionData(obj: unknown): obj is ISerializableChatData {
	const data = obj as ISerializableChatData;
	return isExportableSessionData(obj) &&
		typeof data.creationDate === 'number' &&
		typeof data.sessionId === 'string' &&
		obj.requests.every((request: ISerializableChatRequestData) =>
			!request.usedContext || isIUsedContext(request.usedContext)
		);
}

export type IChatChangeEvent =
	| IChatInitEvent
	| IChatAddRequestEvent | IChatChangedRequestEvent | IChatRemoveRequestEvent
	| IChatAddResponseEvent
	| IChatSetAgentEvent
	| IChatMoveEvent
	| IChatSetHiddenEvent
	| IChatCompletedRequestEvent
	| IChatSetCustomTitleEvent
	;

export interface IChatAddRequestEvent {
	kind: 'addRequest';
	request: IChatRequestModel;
}

export interface IChatChangedRequestEvent {
	kind: 'changedRequest';
	request: IChatRequestModel;
}

export interface IChatCompletedRequestEvent {
	kind: 'completedRequest';
	request: IChatRequestModel;
}

export interface IChatAddResponseEvent {
	kind: 'addResponse';
	response: IChatResponseModel;
}

export const enum ChatRequestRemovalReason {
	Removal,

	Resend,

	Adoption
}

export interface IChatRemoveRequestEvent {
	kind: 'removeRequest';
	requestId: string;
	responseId?: string;
	reason: ChatRequestRemovalReason;
}

export interface IChatSetHiddenEvent {
	kind: 'setHidden';
}

export interface IChatMoveEvent {
	kind: 'move';
	target: URI;
	range: IRange;
}

export interface IChatSetAgentEvent {
	kind: 'setAgent';
	agent: IChatAgentData;
	command?: IChatAgentCommand;
}

export interface IChatSetCustomTitleEvent {
	kind: 'setCustomTitle';
	title: string;
}

export interface IChatInitEvent {
	kind: 'initialize';
}

class InputModel implements IInputModel {
	private readonly _state: ReturnType<typeof observableValue<IChatModelInputState | undefined>>;
	readonly state: IObservable<IChatModelInputState | undefined>;

	private _intendedModel: IIntendedModelSelection | undefined;

	constructor(initialState: IChatModelInputState | undefined, private readonly logger: ILogService, private readonly sessionId: string) {
		this._state = observableValueOpts({ debugName: 'inputModelState', equalsFn: equals }, initialState);
		this.state = this._state;
	}

	get intendedModel(): IIntendedModelSelection | undefined {
		return this._intendedModel;
	}

	setIntendedModel(selection: IIntendedModelSelection | undefined): void {
		this._intendedModel = selection;
	}

	setState(state: Partial<IChatModelInputState>): void {
		const current = this._state.get();
		_logChangesToStateModel(state, current, this.logger, this.sessionId);
		this._state.set({
			attachments: [],
			mode: { id: 'agent', kind: ChatModeKind.Agent },
			selectedModel: undefined,
			inputText: '',
			selections: [],
			...current,
			...state,
			contrib: { ...current?.contrib, ...state.contrib },
			origin: state.origin
		}, undefined);
	}

	clearState(): void {
		this._state.set(undefined, undefined);
	}

	toJSON(): ISerializableChatModelInputState | undefined {
		const value = this.state.get();
		if (!value) {
			return undefined;
		}

		const persistableAttachments = value.attachments.filter(attachment => {
			if (isStringVariableEntry(attachment)) {
				return false;
			}
			if (isImplicitVariableEntry(attachment) && isStringImplicitContextValue(attachment.value)) {
				return false;
			}
			return true;
		});

		return {
			contrib: value.contrib,
			attachments: persistableAttachments.map(IChatRequestVariableEntry.toExport),
			mode: value.mode,
			selectedModel: value.selectedModel ? {
				identifier: value.selectedModel.identifier,
				metadata: value.selectedModel.metadata,
				modelConfiguration: value.modelConfiguration
			} : undefined,
			inputText: value.inputText,
			selections: value.selections,
			permissionLevel: value.permissionLevel,
		};
	}
}

export class ChatModel extends Disposable implements IChatModel {
	static getDefaultTitle(requests: (ISerializableChatRequestData | IChatRequestModel)[]): string {
		const firstRequestMessage = requests.at(0)?.message ?? '';
		const message = typeof firstRequestMessage === 'string' ?
			firstRequestMessage :
			firstRequestMessage.text;
		return message.split('\n')[0].substring(0, 200);
	}

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	private readonly _onDidChange = this._register(new Emitter<IChatChangeEvent>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _pendingRequests: IChatPendingRequest[] = [];
	private readonly _onDidChangePendingRequests = this._register(new Emitter<void>());
	readonly onDidChangePendingRequests = this._onDidChangePendingRequests.event;

	private _requests: ChatRequestModel[];

	private _repoData: IExportableRepoData | undefined;
	public get repoData(): IExportableRepoData | undefined {
		return this._repoData;
	}
	public setRepoData(data: IExportableRepoData | undefined): void {
		this._repoData = data;
	}

	private _workingDirectory: URI | undefined;
	public get workingDirectory(): URI | undefined {
		return this._workingDirectory;
	}
	public setWorkingDirectory(uri: URI | undefined): void {
		this._workingDirectory = uri;
	}

	getPendingRequests(): readonly IChatPendingRequest[] {
		return this._pendingRequests;
	}

	setPendingRequests(requests: readonly { requestId: string; kind: ChatRequestQueueKind }[]): void {
		const existingMap = new Map(this._pendingRequests.map(p => [p.request.id, p]));
		const newPending: IChatPendingRequest[] = [];
		for (const { requestId, kind } of requests) {
			const existing = existingMap.get(requestId);
			if (existing) {
				newPending.push(existing.kind === kind ? existing : { request: existing.request, kind, sendOptions: existing.sendOptions });
			}
		}
		this._pendingRequests.length = 0;
		this._pendingRequests.push(...newPending);
		this._onDidChangePendingRequests.fire();
	}

	replacePendingRequests(requests: readonly IChatPendingRequest[]): void {
		if (this._pendingRequests.length === requests.length && requests.every((request, index) => this._pendingRequests[index] === request)) {
			return;
		}
		this._pendingRequests.length = 0;
		this._pendingRequests.push(...requests);
		this._onDidChangePendingRequests.fire();
	}

	addPendingRequest(request: ChatRequestModel, kind: ChatRequestQueueKind, sendOptions: IChatSendRequestOptions): IChatPendingRequest {
		const pendingRequest: IChatPendingRequest = {
			request,
			kind,
			sendOptions,
		};

		if (kind === ChatRequestQueueKind.Steering) {
			let insertIndex = 0;
			for (let i = 0; i < this._pendingRequests.length; i++) {
				if (this._pendingRequests[i].kind === ChatRequestQueueKind.Steering) {
					insertIndex = i + 1;
				} else {
					break;
				}
			}
			this._pendingRequests.splice(insertIndex, 0, pendingRequest);
		} else {
			this._pendingRequests.push(pendingRequest);
		}

		this._onDidChangePendingRequests.fire();
		return pendingRequest;
	}

	removePendingRequest(id: string): void {
		const index = this._pendingRequests.findIndex(r => r.request.id === id);
		if (index !== -1) {
			this._pendingRequests.splice(index, 1);
			this._onDidChangePendingRequests.fire();
		}
	}

	dequeuePendingRequest(): IChatPendingRequest | undefined {
		const request = this._pendingRequests.shift();
		if (request) {
			this._onDidChangePendingRequests.fire();
		}
		return request;
	}

	dequeueAllSteeringRequests(): IChatPendingRequest[] {
		const steeringRequests: IChatPendingRequest[] = [];
		while (this._pendingRequests.at(0)?.kind === ChatRequestQueueKind.Steering) {
			steeringRequests.push(this._pendingRequests.shift()!);
		}
		if (steeringRequests.length > 0) {
			this._onDidChangePendingRequests.fire();
		}
		return steeringRequests;
	}

	clearPendingRequests(): void {
		if (this._pendingRequests.length > 0) {
			this._pendingRequests.length = 0;
			this._onDidChangePendingRequests.fire();
		}
	}

	readonly lastRequestObs: IObservable<IChatRequestModel | undefined>;

	private readonly _sessionId: string;
	get sessionId(): string {
		return this._sessionId;
	}

	private readonly _sessionResource: URI;
	get sessionResource(): URI {
		return this._sessionResource;
	}

	readonly requestInProgress: IObservable<boolean>;
	readonly hasActiveRequest: IObservable<boolean>;
	readonly requestNeedsInput: IObservable<IChatRequestNeedsInputInfo | undefined>;
	readonly isReadOnly: IObservable<boolean>;

	readonly inputModel: InputModel;

	get hasRequests(): boolean {
		return this._requests.length > 0;
	}

	get lastRequest(): ChatRequestModel | undefined {
		return this._requests.at(-1);
	}

	get sessionCost(): number {
		let summedCredits = 0;
		let reportedSessionCredits = 0;
		for (const request of this._requests) {
			const usage = request.response?.usage;
			if (typeof usage?.copilotCredits === 'number') {
				summedCredits += usage.copilotCredits;
			}
			if (typeof usage?.sessionCopilotCredits === 'number') {
				reportedSessionCredits = Math.max(reportedSessionCredits, usage.sessionCopilotCredits);
			}
		}
		return Math.max(summedCredits, reportedSessionCredits);
	}

	private _timestamp: number;
	get timestamp(): number {
		return this._timestamp;
	}

	get timing(): IChatSessionTiming {
		const lastRequest = this._requests.at(-1);
		const lastResponse = lastRequest?.response;
		const lastRequestStarted = lastRequest?.timestamp;
		const lastRequestEnded = lastResponse?.completedAt ?? lastResponse?.timestamp;
		return {
			created: this._timestamp,
			lastRequestStarted,
			lastRequestEnded,
		};
	}

	get lastMessageDate(): number {
		return this._requests.at(-1)?.timestamp ?? this._timestamp;
	}

	private get _defaultAgent() {
		return this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat, ChatModeKind.Ask);
	}

	private readonly _initialResponderUsername: string | undefined;
	get responderUsername(): string {
		return this._defaultAgent?.fullName ??
			this._initialResponderUsername ?? '';
	}

	private _isImported = false;
	get isImported(): boolean {
		return this._isImported;
	}

	private _isDeleted = false;
	get isDeleted(): boolean {
		return this._isDeleted;
	}
	markDeleted(): void {
		this._isDeleted = true;
	}

	private _customTitle: string | undefined;
	get customTitle(): string | undefined {
		return this._customTitle;
	}

	get title(): string {
		return this._customTitle || ChatModel.getDefaultTitle(this._requests);
	}

	get hasCustomTitle(): boolean {
		return this._customTitle !== undefined;
	}

	private _editingSession: IChatEditingSession | undefined;

	get editingSession(): IChatEditingSession | undefined {
		return this._editingSession;
	}

	private readonly _initialLocation: ChatAgentLocation;
	readonly sessionTypeSelectionReason: SessionTypeSelectionReason | undefined;
	get initialLocation(): ChatAgentLocation {
		return this._initialLocation;
	}

	private readonly _canUseTools: boolean = true;
	get canUseTools(): boolean {
		return this._canUseTools;
	}

	private _disableBackgroundKeepAlive: boolean;
	get willKeepAlive(): boolean {
		return !this._disableBackgroundKeepAlive;
	}

	public dataSerializer?: IChatDataSerializerLog;

	constructor(
		dataRef: ISerializedChatDataReference | undefined,
		initialModelProps: { initialLocation: ChatAgentLocation; canUseTools: boolean; sessionTypeSelectionReason?: SessionTypeSelectionReason; inputState?: ISerializableChatModelInputState; resource?: URI; disableBackgroundKeepAlive?: boolean; isReadOnly?: IObservable<boolean> },
		@ILogService private readonly logService: ILogService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@IChatEditingService private readonly chatEditingService: IChatEditingService,
		@IChatService private readonly chatService: IChatService,
	) {
		super();

		const initialData = dataRef?.value;
		const isValidExportedData = isExportableSessionData(initialData);
		const isValidFullData = isValidExportedData && isSerializableSessionData(initialData);
		if (initialData && !isValidExportedData) {
			this.logService.warn(`ChatModel#constructor: Loaded malformed session data: ${JSON.stringify(initialData)}`);
		}

		this._isImported = !!initialData && isValidExportedData && !isValidFullData;

		if (initialModelProps.resource) {
			this._sessionId = chatSessionResourceToId(initialModelProps.resource);
			this._sessionResource = initialModelProps.resource;
		} else if (isValidFullData) {
			this._sessionId = initialData.sessionId;
			this._sessionResource = LocalChatSessionUri.forSession(initialData.sessionId);
		} else {
			this._sessionId = generateUuid();
			this._sessionResource = LocalChatSessionUri.forSession(this._sessionId);
		}

		this._disableBackgroundKeepAlive = initialModelProps.disableBackgroundKeepAlive ?? false;

		this._timestamp = (isValidFullData && initialData.creationDate) || Date.now();
		this._requests = initialData ? this._deserialize(initialData) : [];
		this._customTitle = isValidFullData ? initialData.customTitle : undefined;

		const serializedInputState = initialModelProps.inputState || (isValidFullData && initialData.inputState ? initialData.inputState : undefined);
		this.inputModel = new InputModel(serializedInputState && reviveSerializableInputState(serializedInputState), this.logService, this._sessionId);

		this.dataSerializer = dataRef?.serializer;
		this._initialResponderUsername = initialData?.responderUsername;

		this._repoData = isValidFullData && initialData.repoData ? initialData.repoData : undefined;

		this._workingDirectory = isValidFullData && initialData.workingDirectory ? URI.parse(initialData.workingDirectory) : undefined;

		if (isValidFullData && initialData.pendingRequests) {
			this._pendingRequests = this._deserializePendingRequests(initialData.pendingRequests);
		}

		this._initialLocation = initialData?.initialLocation ?? initialModelProps.initialLocation;
		this.sessionTypeSelectionReason = initialModelProps.sessionTypeSelectionReason;

		this._canUseTools = initialModelProps.canUseTools;
		this.isReadOnly = initialModelProps.isReadOnly ?? constObservable(false);

		this.lastRequestObs = observableFromEvent(this, this.onDidChange, () => this._requests.at(-1));

		this._register(autorun(reader => {
			const request = this.lastRequestObs.read(reader);
			if (!request?.response) {
				return;
			}

			reader.store.add(request.response.onDidChange(async ev => {
				if (!this._editingSession || ev.reason !== 'completedRequest') {
					return;
				}

				this._onDidChange.fire({ kind: 'completedRequest', request });
			}));
		}));

		this.requestInProgress = this.lastRequestObs.map((request, r) => {
			return request?.response?.isInProgress.read(r) ?? false;
		});

		this.hasActiveRequest = this.lastRequestObs.map((request, r) => {
			return request?.response?.isIncomplete.read(r) ?? false;
		});

		this.requestNeedsInput = this.lastRequestObs.map((request, r) => {
			const pendingInfo = request?.response?.isPendingConfirmation.read(r);
			if (!pendingInfo) {
				return undefined;
			}
			return {
				title: this.title,
				detail: pendingInfo.detail,
			};
		});

		if (this.initialLocation === ChatAgentLocation.Chat && !initialModelProps.disableBackgroundKeepAlive) {
			const selfRef = this._register(new MutableDisposable<IChatModelReference>());
			this._register(autorun(r => {
				const inProgress = this.requestInProgress.read(r);
				const needsInput = this.requestNeedsInput.read(r);
				const shouldStayAlive = inProgress || !!needsInput;
				if (shouldStayAlive && !selfRef.value) {
					selfRef.value = chatService.acquireExistingSession(this._sessionResource, 'ChatModel#requestInProgressKeepAlive');
				} else if (!shouldStayAlive && selfRef.value) {
					selfRef.clear();
				}
			}));
		}
	}

	startEditingSession(isGlobalEditingSession?: boolean, transferFromSession?: IChatEditingSession): void {
		const session = this._editingSession ??= this._register(
			transferFromSession
				? this.chatEditingService.transferEditingSession(this, transferFromSession)
				: isGlobalEditingSession
					? this.chatEditingService.startOrContinueGlobalEditingSession(this)
					: this.chatEditingService.createEditingSession(this)
		);

		if (!this._disableBackgroundKeepAlive) {
			const selfRef = this._register(new MutableDisposable<IChatModelReference>());
			this._register(autorun(r => {
				const hasModified = session.entries.read(r).some(e => e.state.read(r) === ModifiedFileEntryState.Modified);
				if (hasModified && !selfRef.value) {
					selfRef.value = this.chatService.acquireExistingSession(this._sessionResource, 'ChatModel#modifiedEditsKeepAlive');
				} else if (!hasModified && selfRef.value) {
					selfRef.clear();
				}
			}));
		}

		this._register(autorun(reader => {
			this._setDisabledRequests(session.requestDisablement.read(reader));
		}));
	}

	private currentEditedFileEvents = new ResourceMap<IChatAgentEditedFileEvent>();
	notifyEditingAction(action: IChatEditingSessionAction): void {
		const state = action.outcome === 'accepted' ? ChatRequestEditedFileEventKind.Keep :
			action.outcome === 'rejected' ? ChatRequestEditedFileEventKind.Undo :
				action.outcome === 'userModified' ? ChatRequestEditedFileEventKind.UserModification : null;
		if (state === null) {
			return;
		}

		if (!this.currentEditedFileEvents.has(action.uri) || this.currentEditedFileEvents.get(action.uri)?.eventKind === ChatRequestEditedFileEventKind.Keep) {
			this.currentEditedFileEvents.set(action.uri, { eventKind: state, uri: action.uri });
		}
	}

	private _deserialize(obj: IExportableChatData | ISerializedChatDataReference): ChatRequestModel[] {
		const requests = hasKey(obj, { serializer: true }) ? obj.value.requests : obj.requests;
		if (!Array.isArray(requests)) {
			this.logService.error(`Ignoring malformed session data: ${JSON.stringify(obj)}`);
			return [];
		}

		try {
			return requests.map(r => this._deserializeRequest(r));
		} catch (error) {
			this.logService.error('Failed to parse chat data', error);
			return [];
		}
	}

	private _deserializeRequest(raw: ISerializableChatRequestData): ChatRequestModel {
		const parsedRequest =
			typeof raw.message === 'string'
				? this.getParsedRequestFromString(raw.message)
				: reviveParsedChatRequest(raw.message);

		const variableData: IChatRequestVariableData = this.reviveVariableData(raw.variableData);
		const requestTimestamp = typeof raw.timestamp === 'number' && raw.timestamp > 0 ? raw.timestamp : undefined;
		const request = new ChatRequestModel({
			session: this,
			message: parsedRequest,
			variableData,
			timestamp: requestTimestamp,
			fallbackTimestamp: this._timestamp,
			restoredId: raw.requestId,
			confirmation: raw.confirmation,
			editedFileEvents: raw.editedFileEvents,
			modelId: raw.modelId,
			modeInfo: raw.modeInfo,
			isSystemInitiated: raw.isSystemInitiated,
			isHiddenFromTranscript: raw.hiddenFromTranscript,
			isRequestHiddenFromTranscript: raw.requestHiddenFromTranscript,
			systemInitiatedLabel: raw.systemInitiatedLabel,
			terminalExecutionId: raw.terminalExecutionId,
			origin: reviveChatRequestOrigin(raw.origin),
		});
		request.shouldBeRemovedOnSend = raw.isHidden ? { requestId: raw.requestId } : raw.shouldBeRemovedOnSend;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, local/code-no-any-casts
		if (raw.response || raw.result || (raw as any).responseErrorDetails) {
			const agent = (raw.agent && 'metadata' in raw.agent) ?
				reviveSerializedAgent(raw.agent) : undefined;

			const result = 'responseErrorDetails' in raw ?
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				{ errorDetails: raw.responseErrorDetails } as IChatAgentResult : raw.result;
			let modelState = raw.modelState || { value: raw.isCanceled ? ResponseModelState.Cancelled : ResponseModelState.Complete, completedAt: Date.now() };
			if (modelState.value === ResponseModelState.Pending || modelState.value === ResponseModelState.NeedsInput) {
				modelState = { value: ResponseModelState.Cancelled, completedAt: Date.now() };
			}

			if (raw.response) {
				for (const part of raw.response) {
					if (hasKey(part, { kind: true }) && (part.kind === 'questionCarousel' || part.kind === 'planReview')) {
						part.isUsed = true;
					}
				}
			}

			request.response = new ChatResponseModel({
				responseContent: raw.response ?? [new MarkdownString(raw.response)],
				session: this,
				agent,
				slashCommand: raw.slashCommand,
				requestId: request.id,
				modelState,
				completionTimestamp: raw.modelState && 'completedAt' in raw.modelState && Number.isFinite(raw.modelState.completedAt) && raw.modelState.completedAt > 0
					? raw.modelState.completedAt
					: null,
				vote: raw.vote,
				timestamp: typeof raw.responseTimestamp === 'number' && raw.responseTimestamp > 0 ? raw.responseTimestamp : requestTimestamp,
				result,
				followups: raw.followups,
				restoredId: raw.responseId,
				timeSpentWaiting: raw.timeSpentWaiting,
				elapsedMs: raw.elapsedMs,
				shouldBeBlocked: request.shouldBeBlocked.get(),
				codeBlockInfos: raw.responseMarkdownInfo?.map<ICodeBlockInfo>(info => ({ suggestionId: info.suggestionId })),
			});
			request.response.shouldBeRemovedOnSend = raw.isHidden ? { requestId: raw.requestId } : raw.shouldBeRemovedOnSend;
			if (typeof raw.completionTokens === 'number' || typeof raw.promptTokens === 'number' || typeof raw.copilotCredits === 'number' || typeof raw.sessionCopilotCredits === 'number') {
				request.response.setUsage({
					kind: 'usage',
					promptTokens: raw.promptTokens ?? 0,
					completionTokens: raw.completionTokens ?? 0,
					outputBuffer: raw.outputBuffer,
					promptTokenDetails: raw.promptTokenDetails,
					copilotCredits: raw.copilotCredits,
					modelTotals: raw.modelTotals,
					sessionCopilotCredits: raw.sessionCopilotCredits,
				});
			}
			if (raw.usedContext) {
				request.response.applyReference(revive(raw.usedContext));
			}

			raw.contentReferences?.forEach(r => request.response!.applyReference(revive(r)));
			raw.codeCitations?.forEach(c => request.response!.applyCodeCitation(revive(c)));
		}
		return request;
	}

	private reviveVariableData(raw: IChatRequestVariableData): IChatRequestVariableData {
		const variableData = raw && Array.isArray(raw.variables)
			? raw :
			{ variables: [] };

		variableData.variables = variableData.variables.map<IChatRequestVariableEntry>(IChatRequestVariableEntry.fromExport);

		return variableData;
	}

	private getParsedRequestFromString(message: string): IParsedChatRequest {
		const parts = [new ChatRequestTextPart(new OffsetRange(0, message.length), { startColumn: 1, startLineNumber: 1, endColumn: 1, endLineNumber: 1 }, message)];
		return {
			text: message,
			parts
		};
	}

	private _deserializePendingRequests(pendingRequests: ISerializablePendingRequestData[]): IChatPendingRequest[] {
		try {
			return pendingRequests.map(pending => ({
				id: pending.id,
				request: this._deserializeRequest(pending.request),
				kind: pending.kind,
				sendOptions: {
					...pending.sendOptions,
					userSelectedTools: pending.sendOptions.userSelectedTools
						? constObservable(pending.sendOptions.userSelectedTools)
						: undefined,
				}
			}));
		} catch (e) {
			this.logService.error('Failed to parse pending chat requests', e);
			return [];
		}
	}



	getRequests(): ChatRequestModel[] {
		return this._requests;
	}

	resetCheckpoint(): void {
		for (const request of this._requests) {
			request.setShouldBeBlocked(false);
			if (request.response) {
				request.response.setBlockedState(false);
			}
		}
	}

	setCheckpoint(requestId: string | undefined) {
		let checkpoint: ChatRequestModel | undefined;
		let checkpointIndex = -1;
		if (requestId !== undefined) {
			this._requests.forEach((request, index) => {
				if (request.id === requestId) {
					checkpointIndex = index;
					checkpoint = request;
					request.setShouldBeBlocked(true);
				}
			});

			if (!checkpoint) {
				return;
			}
		}

		for (let i = this._requests.length - 1; i >= 0; i -= 1) {
			const request = this._requests[i];
			if (this._checkpoint && !checkpoint) {
				request.setShouldBeBlocked(false);
				if (request.response) {
					request.response.setBlockedState(false);
				}
			} else if (checkpoint && i >= checkpointIndex) {
				request.setShouldBeBlocked(true);
				if (request.response) {
					request.response.setBlockedState(true);
				}
			} else if (checkpoint && i < checkpointIndex) {
				request.setShouldBeBlocked(false);
				if (request.response) {
					request.response.setBlockedState(false);
				}
			}
		}

		this._checkpoint = checkpoint;
	}

	private _checkpoint: ChatRequestModel | undefined = undefined;
	public get checkpoint() {
		return this._checkpoint;
	}

	private _setDisabledRequests(requestIds: IChatRequestDisablement[]) {
		this._requests.forEach((request) => {
			const shouldBeRemovedOnSend = requestIds.find(r => r.requestId === request.id);
			request.shouldBeRemovedOnSend = shouldBeRemovedOnSend;
			if (request.response) {
				request.response.shouldBeRemovedOnSend = shouldBeRemovedOnSend;
			}
		});

		this._onDidChange.fire({ kind: 'setHidden' });
	}

	addRequest(
		message: IParsedChatRequest,
		variableData: IChatRequestVariableData,
		attempt: number,
		modeInfo?: IChatRequestModeInfo,
		chatAgent?: IChatAgentData,
		slashCommand?: IChatAgentCommand,
		confirmation?: string,
		locationData?: IChatLocationData,
		attachments?: IChatRequestVariableEntry[],
		isCompleteAddedRequest?: boolean,
		modelId?: string,
		userSelectedTools?: UserSelectedTools,
		id?: string,
		isSystemInitiated?: boolean,
		systemInitiatedLabel?: string,
		terminalExecutionId?: string,
		isTerminalCommand?: boolean,
		timestamp?: number | null,
		hideFromTranscript?: boolean,
		origin?: IChatRequestOrigin,
		isRequestHiddenFromTranscript?: boolean,
	): ChatRequestModel {
		const editedFileEvents = [...this.currentEditedFileEvents.values()];
		this.currentEditedFileEvents.clear();
		const requestTimestamp = timestamp === undefined
			? Date.now()
			: typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
				? timestamp
				: undefined;
		const request = new ChatRequestModel({
			restoredId: id,
			session: this,
			message,
			variableData,
			timestamp: requestTimestamp,
			fallbackTimestamp: this._timestamp,
			attempt,
			modeInfo,
			confirmation,
			locationData,
			attachedContext: attachments,
			isCompleteAddedRequest,
			modelId,
			editedFileEvents: editedFileEvents.length ? editedFileEvents : undefined,
			userSelectedTools,
			isSystemInitiated,
			isHiddenFromTranscript: hideFromTranscript,
			isRequestHiddenFromTranscript,
			systemInitiatedLabel,
			terminalExecutionId,
			isTerminalCommand,
			origin,
		});
		request.response = new ChatResponseModel({
			responseContent: [],
			session: this,
			agent: chatAgent,
			slashCommand,
			requestId: request.id,
			isCompleteAddedRequest,
			codeBlockInfos: undefined,
		});
		this._requests.push(request);
		markChat(this.sessionResource, ChatPerfMark.RequestUiUpdated);
		this._onDidChange.fire({ kind: 'addRequest', request });
		return request;
	}

	public setCustomTitle(title: string): void {
		this._customTitle = title;
		this._onDidChange.fire({ kind: 'setCustomTitle', title });
	}

	updateRequest(request: ChatRequestModel, variableData: IChatRequestVariableData) {
		request.variableData = variableData;
		this._onDidChange.fire({ kind: 'changedRequest', request });
	}

	adoptRequest(request: ChatRequestModel): void {
		const oldOwner = request.session;
		const index = oldOwner._requests.findIndex((candidate: ChatRequestModel) => candidate.id === request.id);

		if (index === -1) {
			return;
		}

		oldOwner._requests.splice(index, 1);

		request.adoptTo(this);
		request.response?.adoptTo(this);
		this._requests.push(request);

		oldOwner._onDidChange.fire({ kind: 'removeRequest', requestId: request.id, responseId: request.response?.id, reason: ChatRequestRemovalReason.Adoption });
		this._onDidChange.fire({ kind: 'addRequest', request });
	}

	acceptResponseProgress(request: ChatRequestModel, progress: IChatProgress, quiet?: boolean): void {
		if (!request.response) {
			request.response = new ChatResponseModel({
				responseContent: [],
				session: this,
				requestId: request.id,
				codeBlockInfos: undefined,
			});
		}

		if (request.response.isComplete) {
			throw new Error('acceptResponseProgress: Adding progress to a completed response');
		}

		if (progress.kind === 'usage') {
			request.response.setUsage(progress);
		} else if (progress.kind === 'usedContext' || progress.kind === 'reference') {
			request.response.applyReference(progress);
		} else if (progress.kind === 'codeCitation') {
			request.response.applyCodeCitation(progress);
		} else if (progress.kind === 'move') {
			this._onDidChange.fire({ kind: 'move', target: progress.uri, range: progress.range });
		} else if (progress.kind === 'codeblockUri' && progress.isEdit) {
			request.response.addUndoStop({ id: progress.undoStopId ?? generateUuid(), kind: 'undoStop' });
			request.response.updateContent(progress, quiet);
		} else if (progress.kind === 'progressTaskResult') {
			this.logService.error(`Couldn't handle progress: ${JSON.stringify(progress)}`);
		} else {
			request.response.updateContent(progress, quiet);
		}
	}

	removeRequest(id: string, reason: ChatRequestRemovalReason = ChatRequestRemovalReason.Removal): void {
		const index = this._requests.findIndex(request => request.id === id);
		const request = this._requests[index];

		if (index !== -1) {
			this._onDidChange.fire({ kind: 'removeRequest', requestId: request.id, responseId: request.response?.id, reason });
			this._requests.splice(index, 1);
			request.response?.dispose();
		}
	}

	cancelRequest(request: ChatRequestModel): void {
		if (request.response) {
			request.response.cancel();
		}
	}

	setResponse(request: ChatRequestModel, result: IChatAgentResult): void {
		if (!request.response) {
			request.response = new ChatResponseModel({
				responseContent: [],
				session: this,
				requestId: request.id,
				codeBlockInfos: undefined,
			});
		}

		request.response.setResult(result);
	}

	setFollowups(request: ChatRequestModel, followups: IChatFollowup[] | undefined): void {
		if (!request.response) {
			return;
		}
		request.response.setFollowups(followups);
	}

	setResponseModel(request: ChatRequestModel, response: ChatResponseModel): void {
		request.response = response;
		this._onDidChange.fire({ kind: 'addResponse', response });
	}

	toExport(): IExportableChatData {
		return {
			responderUsername: this.responderUsername,
			initialLocation: this.initialLocation,
			requests: this._requests.map((r): ISerializableChatRequestData => {
				const message = {
					...r.message,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					parts: r.message.parts.map((p: any) => p && 'toJSON' in p ? (p.toJSON as Function)() : p)
				};
				const agent = r.response?.agent;
				const agentJson = agent && 'toJSON' in agent ? (agent.toJSON as Function)() :
					agent ? { ...agent } : undefined;
				return {
					requestId: r.id,
					message,
					variableData: IChatRequestVariableData.toExport(r.variableData),
					response: r.response ?
						r.response.entireResponse.value.filter(item => item.kind !== 'voiceProgress').map(item => {
							if (item.kind === 'treeData') {
								return item.treeData;
							} else if (item.kind === 'markdownContent') {
								return item.content;
							} else {
								// eslint-disable-next-line local/code-no-any-casts, @typescript-eslint/no-explicit-any
								return item as any;
							}
						})
						: undefined,
					shouldBeRemovedOnSend: r.shouldBeRemovedOnSend,
					agent: agentJson,
					timestamp: r.requestTimestamp,
					confirmation: r.confirmation,
					editedFileEvents: r.editedFileEvents,
					modelId: r.modelId,
					modeInfo: r.modeInfo,
					isSystemInitiated: r.isSystemInitiated || undefined,
					hiddenFromTranscript: r.isHiddenFromTranscript || undefined,
					...(r.isRequestHiddenFromTranscript && !r.isHiddenFromTranscript ? { requestHiddenFromTranscript: true } : {}),
					systemInitiatedLabel: r.systemInitiatedLabel,
					terminalExecutionId: r.terminalExecutionId,
					origin: r.origin ? serializeChatRequestOrigin(r.origin) : undefined,
					...r.response?.toJSON(),
				};
			}),
		};
	}

	toJSON(): ISerializableChatData {
		return {
			version: 3,
			...this.toExport(),
			sessionId: this.sessionId,
			creationDate: this._timestamp,
			customTitle: this._customTitle,
			inputState: this.inputModel.toJSON(),
			workingDirectory: this._workingDirectory?.toString(),
		};
	}

	override dispose() {
		this._requests.forEach(r => r.response?.dispose());
		this._onDidDispose.fire();

		super.dispose();

		this._requests.length = 0;
		this.dataSerializer = undefined;
		this._editingSession = undefined;
	}
}

export function updateRanges(variableData: IChatRequestVariableData, diff: number): IChatRequestVariableData {
	return {
		variables: variableData.variables.map(v => ({
			...v,
			range: v.range && {
				start: v.range.start - diff,
				endExclusive: v.range.endExclusive - diff
			}
		}))
	};
}

export function canMergeMarkdownStrings(md1: IMarkdownString, md2: IMarkdownString): boolean {
	if (md1.baseUri && md2.baseUri) {
		const baseUriEquals = md1.baseUri.scheme === md2.baseUri.scheme
			&& md1.baseUri.authority === md2.baseUri.authority
			&& md1.baseUri.path === md2.baseUri.path
			&& md1.baseUri.query === md2.baseUri.query
			&& md1.baseUri.fragment === md2.baseUri.fragment;
		if (!baseUriEquals) {
			return false;
		}
	} else if (md1.baseUri || md2.baseUri) {
		return false;
	}

	return equals(md1.isTrusted, md2.isTrusted) &&
		md1.supportHtml === md2.supportHtml &&
		md1.supportThemeIcons === md2.supportThemeIcons;
}

function isNestedSubagentResponsePart(part: IChatProgressResponseContent): boolean {
	return 'subAgentInvocationId' in part && !!part.subAgentInvocationId;
}

export function appendMarkdownString(md1: IMarkdownString, md2: IMarkdownString | string): IMarkdownString {
	const appendedValue = typeof md2 === 'string' ? md2 : md2.value;
	return {
		value: md1.value + appendedValue,
		isTrusted: md1.isTrusted,
		supportThemeIcons: md1.supportThemeIcons,
		supportHtml: md1.supportHtml,
		baseUri: md1.baseUri
	};
}

export function getCodeCitationsMessage(citations: ReadonlyArray<IChatCodeCitation>): string {
	if (citations.length === 0) {
		return '';
	}

	const licenseTypes = citations.reduce((set, c) => set.add(c.license), new Set<string>());
	const label = licenseTypes.size === 1 ?
		localize('codeCitation', "Similar code found with 1 license type", licenseTypes.size) :
		localize('codeCitations', "Similar code found with {0} license types", licenseTypes.size);
	return label;
}

export function serializeSendOptions(options: IChatSendRequestOptions): ISerializableSendOptions {
	return {
		modeInfo: options.modeInfo,
		userSelectedModelId: options.userSelectedModelId,
		userSelectedModelConfiguration: options.userSelectedModelConfiguration,
		userSelectedTools: options.userSelectedTools?.get(),
		instructionContext: options.instructionContext,
		location: options.location,
		locationData: options.locationData,
		attempt: options.attempt,
		noCommandDetection: options.noCommandDetection,
		isVoiceModeInput: options.isVoiceModeInput,
		agentId: options.agentId,
		agentIdSilent: options.agentIdSilent,
		slashCommand: options.slashCommand,
		confirmation: options.confirmation,
		isSystemInitiated: options.isSystemInitiated,
		hideFromTranscript: options.hideFromTranscript,
		systemInitiatedLabel: options.systemInitiatedLabel,
		terminalExecutionId: options.terminalExecutionId,
	};
}

export enum ChatRequestEditedFileEventKind {
	Keep = 1,
	Undo = 2,
	UserModification = 3,
}

export interface IChatAgentEditedFileEvent {
	readonly uri: URI;
	readonly eventKind: ChatRequestEditedFileEventKind;
}

export namespace ChatResponseResource {
	export const scheme = Schemas.vscodeChatResponseResource;

	export function createUri(sessionResource: URI, toolCallId: string, index: number, basename?: string): URI {
		return URI.from({
			scheme: ChatResponseResource.scheme,
			authority: encodeHex(VSBuffer.fromString(sessionResource.toString())),
			path: `/tool/${toolCallId}/${index}` + (basename ? `/${basename}` : ''),
		});
	}

	export function parseUri(uri: URI): undefined | { sessionResource: URI; toolCallId: string; index: number } {
		if (uri.scheme !== ChatResponseResource.scheme) {
			return undefined;
		}

		const parts = uri.path.split('/');
		if (parts.length < 4) {
			return undefined;
		}

		const [, kind, toolCallId, index] = parts;
		if (kind !== 'tool') {
			return undefined;
		}

		let sessionResource: URI;
		try {
			sessionResource = URI.parse(decodeHex(uri.authority).toString());
		} catch (e) {
			if (e instanceof SyntaxError) {
				sessionResource = LocalChatSessionUri.forSession(uri.authority);
			} else {
				throw e;
			}
		}

		return {
			sessionResource,
			toolCallId: toolCallId,
			index: Number(index),
		};
	}
}

function _logChangesToStateModel(newState: Partial<IChatModelInputState> | undefined, oldState: Partial<IChatModelInputState> | undefined, logger: ILogService, sessionId: string) {
	if (!canLog(logger.getLevel(), LogLevel.Debug) || newState?.selectedModel?.identifier === oldState?.selectedModel?.identifier) {
		return;
	}
	const stack = new Error().stack;
	const message = `[ChatModelChanged] ChatModel Input State model changed: ${newState?.selectedModel?.identifier} (was: ${oldState?.selectedModel?.identifier}) in session ${sessionId} ${stack}`;
	logger.debug(message);
}

export function logChangesToStateModel(model: IInputModel | undefined, message: string, newState: Partial<IChatModelInputState> | undefined, oldState: Partial<IChatModelInputState> | undefined, logger: ILogService) {
	if (!canLog(logger.getLevel(), LogLevel.Debug)) {
		return;
	}
	message = [message,
		`model.selectedModel: ${model?.state.get()?.selectedModel?.identifier}`,
		`new state: ${newState?.selectedModel?.identifier}`,
		`old state: ${oldState?.selectedModel?.identifier}`,
		new Error().stack
	].join(', ');

	logger.debug(`[ChatModelChanged] Chat Model Changed,${message}`);
}
