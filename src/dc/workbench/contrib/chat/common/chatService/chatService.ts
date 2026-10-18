/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { Event } from '../../../../../base/common/event.js';
import { IMarkdownString } from '../../../../../base/common/htmlContent.js';
import { DisposableStore, IDisposable, IReference } from '../../../../../base/common/lifecycle.js';
import { autorun, autorunSelfDisposable, IObservable, IReader } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { hasKey } from '../../../../../base/common/types.js';
import { URI, UriComponents } from '../../../../../base/common/uri.js';
import { IRange, Range } from '../../../../../editor/common/core/range.js';
import { ISelection } from '../../../../../editor/common/core/selection.js';
import { Command, Location, TextEdit } from '../../../../../editor/common/languages.js';
import { FileType } from '../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAutostartResult } from '../../../mcp/common/mcpTypes.js';
import { ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { IWorkspaceSymbol } from '../../../search/common/search.js';
import { IChatRequestVariableEntry } from '../attachments/chatVariableEntries.js';
import { IChatRequestVariableValue } from '../attachments/chatVariables.js';
import { ReadonlyChatSessionOptionsMap } from '../chatSessionsService.js';
import { ChatAgentLocation, SessionTypeSelectionReason, ChatModeKind } from '../constants.js';
import { IChatEditingSession } from '../editing/chatEditingService.js';
import type { IChatModel, IChatRequestModeInfo, IChatRequestModel, IChatRequestVariableData, IChatResponseModel, IExportableChatData, ISerializableChatData } from '../model/chatModel.js';
import type { IChatModelReferenceDebugSnapshot } from '../model/chatModelStore.js';
import type { IChatAgentCommand, IChatAgentData, IChatAgentResult, UserSelectedTools } from '../participants/chatAgents.js';
import { HookTypeValue } from '../promptSyntax/hookTypes.js';
import { ICustomizationMigrationHint } from '../promptSyntax/service/customizationMigrationService.js';
import { IParsedChatRequest } from '../requestParser/chatParserTypes.js';
import { IChatParserContext } from '../requestParser/chatRequestParser.js';
import { IPreparedToolInvocation, IToolConfirmationMessages, IToolResult, IToolResultInputOutputDetails, ToolDataSource } from '../tools/languageModelToolsService.js';
import { ConfirmationOptionKind, type McpOAuthClient } from '../../../../../platform/agentHost/common/state/protocol/state.js';

export interface IChatRequest {
	message: string;
	variables: Record<string, IChatRequestVariableValue[]>;
}

export enum ChatErrorLevel {
	Info = 0,
	Warning = 1,
	Error = 2
}

export interface IChatResponseErrorDetailsConfirmationButton {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
	label: string;
	isSecondary?: boolean;
	resend?: boolean;
	preserveRequestId?: boolean;
}

export interface IChatResponseErrorDetails {
	message: string;
	responseIsIncomplete?: boolean;
	responseIsFiltered?: boolean;
	responseIsRedacted?: boolean;
	isQuotaExceeded?: boolean;
	isRateLimited?: boolean;
	isExpectedError?: boolean;
	level?: ChatErrorLevel;
	confirmationButtons?: IChatResponseErrorDetailsConfirmationButton[];
	code?: string;
}

export interface IChatResponseProgressFileTreeData {
	label: string;
	uri: URI;
	type?: FileType;
	children?: IChatResponseProgressFileTreeData[];
}

export type IDocumentContext = {
	uri: URI;
	version: number;
	ranges: IRange[];
};

export function isIDocumentContext(obj: unknown): obj is IDocumentContext {
	return (
		!!obj &&
		typeof obj === 'object' &&
		'uri' in obj && obj.uri instanceof URI &&
		'version' in obj && typeof obj.version === 'number' &&
		'ranges' in obj && Array.isArray(obj.ranges) && obj.ranges.every(Range.isIRange)
	);
}

export interface IChatUsedContext {
	documents: IDocumentContext[];
	kind: 'usedContext';
}

export function isIUsedContext(obj: unknown): obj is IChatUsedContext {
	return (
		!!obj &&
		typeof obj === 'object' &&
		'documents' in obj &&
		Array.isArray(obj.documents) &&
		obj.documents.every(isIDocumentContext)
	);
}

export interface IChatContentVariableReference {
	variableName: string;
	value?: URI | Location;
}

export function isChatContentVariableReference(obj: unknown): obj is IChatContentVariableReference {
	return !!obj &&
		typeof obj === 'object' &&
		typeof (obj as IChatContentVariableReference).variableName === 'string';
}

export enum ChatResponseReferencePartStatusKind {
	Complete = 1,
	Partial = 2,
	Omitted = 3
}

export enum ChatResponseClearToPreviousToolInvocationReason {
	NoReason = 0,
	FilteredContentRetry = 1,
	CopyrightContentRetry = 2,
}

export interface IChatContentReference {
	reference: URI | Location | IChatContentVariableReference | string;
	iconPath?: ThemeIcon | { light: URI; dark?: URI };
	options?: {
		status?: { description: string; kind: ChatResponseReferencePartStatusKind };
		diffMeta?: { added: number; removed: number };
		originalUri?: URI;
		modifiedUri?: URI;
		isDeletion?: boolean;
	};
	kind: 'reference';
}

export interface IChatCodeCitation {
	value: URI;
	license: string;
	snippet: string;
	kind: 'codeCitation';
}

export interface IChatUsagePromptTokenDetail {
	category: string;
	label: string;
	percentageOfPrompt: number;
}

export interface IChatUsageModelTotal {
	readonly model: string;
	readonly inputTokens: number;
	readonly cachedTokens: number;
	readonly outputTokens: number;
}

export interface IChatUsage {
	promptTokens: number;
	completionTokens: number;
	outputBuffer?: number;
	promptTokenDetails?: readonly IChatUsagePromptTokenDetail[];
	copilotCredits?: number;
	modelTotals?: readonly IChatUsageModelTotal[];
	sessionCopilotCredits?: number;
	actualModelId?: string;
	kind: 'usage';
}

export function formatCopilotCredits(credits: number): string {
	return parseFloat(credits.toFixed(1)).toString();
}

export function formatCopilotCreditsLabel(credits: number): string {
	const formatted = formatCopilotCredits(credits);
	return formatted === '1'
		? localize('chat.credit', "{0} credit", formatted)
		: localize('chat.credits', "{0} credits", formatted);
}

export interface IChatContentInlineReference {
	resolveId?: string;
	inlineReference: URI | Location | IWorkspaceSymbol;
	name?: string;
	kind: 'inlineReference';
}

export interface IChatMarkdownContent {
	kind: 'markdownContent';
	content: IMarkdownString;
	inlineReferences?: Record<string, IChatContentInlineReference>;
}

export interface IChatTreeData {
	treeData: IChatResponseProgressFileTreeData;
	kind: 'treeData';
}
export interface IMultiDiffResource {
	originalUri?: URI;
	modifiedUri?: URI;
	goToFileUri?: URI;
	added?: number;
	removed?: number;
}

export interface IChatMultiDiffInnerData {
	title: string;
	resources: IMultiDiffResource[];
}

export interface IChatMultiDiffData {
	multiDiffData: IChatMultiDiffInnerData | IObservable<IChatMultiDiffInnerData>;
	kind: 'multiDiffData';
	collapsed?: boolean;
	readOnly?: boolean;
	toJSON(): IChatMultiDiffDataSerialized;
}

export interface IChatMultiDiffDataSerialized {
	multiDiffData: IChatMultiDiffInnerData;
	kind: 'multiDiffData';
	collapsed?: boolean;
	readOnly?: boolean;
}

export class ChatMultiDiffData implements IChatMultiDiffData {
	public readonly kind = 'multiDiffData';
	public readonly collapsed?: boolean | undefined;
	public readonly readOnly?: boolean | undefined;
	public readonly multiDiffData: IChatMultiDiffData['multiDiffData'];

	constructor(opts: {
		multiDiffData: IChatMultiDiffInnerData | IObservable<IChatMultiDiffInnerData>;
		collapsed?: boolean;
		readOnly?: boolean;
	}) {
		this.readOnly = opts.readOnly;
		this.collapsed = opts.collapsed;
		this.multiDiffData = opts.multiDiffData;
	}

	toJSON(): IChatMultiDiffDataSerialized {
		return {
			kind: this.kind,
			multiDiffData: hasKey(this.multiDiffData, { title: true }) ? this.multiDiffData : this.multiDiffData.get(),
			collapsed: this.collapsed,
			readOnly: this.readOnly,
		};
	}
}

export interface IChatProgressMessage {
	content: IMarkdownString;
	kind: 'progressMessage';
	shimmer?: boolean;
	id?: string;
}

export interface IChatSystemNotificationPart {
	content: IMarkdownString;
	kind: 'systemNotification';
	icon?: ThemeIcon;
	collapsible?: boolean;
	renderInlineTiming?: boolean;
	presentation?: 'workspaceTransition';
	workspaceName?: string;
	accessibilityLabel?: string;
}

export interface IChatTask extends IChatTaskDto {
	deferred: DeferredPromise<string | void>;
	progress: (IChatWarningMessage | IChatContentReference)[];
	readonly onDidAddProgress: Event<IChatWarningMessage | IChatContentReference>;
	add(progress: IChatWarningMessage | IChatContentReference): void;

	complete: (result: string | void) => void;
	task: () => Promise<string | void>;
	isSettled: () => boolean;
	toJSON(): IChatTaskSerialized;
}

export interface IChatUndoStop {
	kind: 'undoStop';
	id: string;
}

export interface IChatExternalEditsDto {
	kind: 'externalEdits';
	undoStopId: string;
	start: boolean;
	resources: UriComponents[];
	contentFor?: UriComponents[];
}

export interface IChatTaskDto {
	content: IMarkdownString;
	kind: 'progressTask';
}

export interface IChatTaskSerialized {
	content: IMarkdownString;
	progress: (IChatWarningMessage | IChatContentReference)[];
	kind: 'progressTaskSerialized';
}

export interface IChatTaskResult {
	content: IMarkdownString | void;
	kind: 'progressTaskResult';
}

export interface IChatWarningMessage {
	content: IMarkdownString;
	kind: 'warning';
}

export interface IChatInfoMessage {
	content: IMarkdownString;
	kind: 'info';
}

export interface IChatAgentVulnerabilityDetails {
	title: string;
	description: string;
}

export interface IChatResponseCodeblockUriPart {
	kind: 'codeblockUri';
	uri: URI;
	isEdit?: boolean;
	undoStopId?: string;
	subAgentInvocationId?: string;
}

export interface IChatAgentMarkdownContentWithVulnerability {
	content: IMarkdownString;
	vulnerabilities: IChatAgentVulnerabilityDetails[];
	kind: 'markdownVuln';
}

export interface IChatCommandButton {
	command: Command;
	kind: 'command';
	additionalCommands?: Command[];
}

export interface IChatMoveMessage {
	uri: URI;
	range: IRange;
	kind: 'move';
}

export interface IChatTextEdit {
	uri: URI;
	edits: TextEdit[];
	kind: 'textEdit';
	done?: boolean;
	isExternalEdit?: boolean;
}

export interface IChatClearToPreviousToolInvocation {
	kind: 'clearToPreviousToolInvocation';
	reason: ChatResponseClearToPreviousToolInvocationReason;
}

export interface IChatNotebookEdit {
	uri: URI;
	edits: ICellEditOperation[];
	kind: 'notebookEdit';
	done?: boolean;
	isExternalEdit?: boolean;
}

export interface IChatWorkspaceFileEdit {
	oldResource?: URI;
	newResource?: URI;
}

export interface IChatWorkspaceEdit {
	kind: 'workspaceEdit';
	edits: IChatWorkspaceFileEdit[];
}

export type ChatExternalEditKind = 'create' | 'delete' | 'rename' | 'edit';

export interface IChatExternalEdit {
	kind: 'externalEdit';
	uri: URI;
	editKind: ChatExternalEditKind;
	originalUri?: URI;
	beforeContentUri?: URI;
	afterContentUri?: URI;
	diff?: { added: number; removed: number };
	undoStopId?: string;
}

export interface IChatConfirmation {
	title: string;
	message: string | IMarkdownString;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
	buttons?: string[];
	isUsed?: boolean;
	kind: 'confirmation';
}

export interface IChatQuestionValidation {
	minLength?: number;
	maxLength?: number;
	format?: 'email' | 'uri' | 'date' | 'date-time';
	minimum?: number;
	maximum?: number;
	isInteger?: boolean;
}

export interface IChatQuestion {
	id: string;
	type: 'text' | 'singleSelect' | 'multiSelect';
	title: string;
	message?: string | IMarkdownString;
	description?: string;
	options?: { id: string; label: string; value: string }[];
	defaultValue?: string | string[];
	allowFreeformInput?: boolean;
	required?: boolean;
	validation?: IChatQuestionValidation;
	detailedMessage?: string | IMarkdownString;
}

export interface IChatSingleSelectAnswer {
	selectedValue?: string;
	freeformValue?: string;
}

export interface IChatMultiSelectAnswer {
	selectedValues: string[];
	freeformValue?: string;
}

export type IChatQuestionAnswerValue = string | IChatSingleSelectAnswer | IChatMultiSelectAnswer;

export type IChatQuestionAnswers = Record<string, IChatQuestionAnswerValue>;

export interface IChatQuestionCarousel {
	questions: IChatQuestion[];
	allowSkip: boolean;
	resolveId?: string;
	data?: IChatQuestionAnswers;
	isUsed?: boolean;
	answeredExternally?: boolean;
	autoReply?: boolean;
	message?: string | IMarkdownString;
	source?: ToolDataSource;
	terminalId?: string;
	answerPresentation?: 'conversation';
	kind: 'questionCarousel';
}

export const enum ElicitationState {
	Pending = 'pending',
	Accepted = 'accepted',
	Rejected = 'rejected',
}

export interface IChatElicitationRequest {
	kind: 'elicitation2';
	title: string | IMarkdownString;
	message: string | IMarkdownString;
	acceptButtonLabel: string;
	rejectButtonLabel: string | undefined;
	subtitle?: string | IMarkdownString;
	source?: ToolDataSource;
	state: IObservable<ElicitationState>;
	acceptedResult?: Record<string, unknown>;
	moreActions?: IAction[];
	riskAssessment?: { toolId: string; parameters: unknown };
	accept(value: IAction | true): Promise<void>;
	reject?: () => Promise<void>;
	isHidden?: IObservable<boolean>;
	hide?(): void;
	toJSON(): IChatElicitationRequestSerialized;
}

export interface IChatElicitationRequestSerialized {
	kind: 'elicitationSerialized';
	title: string | IMarkdownString;
	message: string | IMarkdownString;
	subtitle: string | IMarkdownString | undefined;
	source: ToolDataSource | undefined;
	state: ElicitationState.Accepted | ElicitationState.Rejected;
	isHidden: boolean;
	acceptedResult?: Record<string, unknown>;
}

export interface IChatThinkingPart {
	kind: 'thinking';
	value?: string | string[];
	id?: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	metadata?: { readonly [key: string]: any };
	generatedTitle?: string;
	reasoningDurationMs?: number;
}

export interface IChatAutoModeResolutionPart {
	kind: 'autoModeResolution';
	resolved?: { readonly id: string; readonly name: string };
}

export interface IChatHookPart {
	kind: 'hook';
	hookType: HookTypeValue;
	stopReason?: string;
	systemMessage?: string;
	toolDisplayName?: string;
	metadata?: { readonly [key: string]: unknown };
	subAgentInvocationId?: string;
}

export type ChatVoiceProgressStage = 'investigating' | 'planning' | 'editing' | 'validating' | 'recovering';

export interface IChatVoiceProgressPart {
	readonly kind: 'voiceProgress';
	readonly id: ChatVoiceProgressStage;
	readonly value: string;
}

export interface IChatTerminalToolInvocationData {
	kind: 'terminal';
	commandLine: {
		original: string;
		userEdited?: string;
		toolEdited?: string;
		forDisplay?: string;
		isSandboxWrapped?: boolean;
	};
	editable?: boolean;
	intention?: string;
	cwd?: UriComponents;
	confirmation?: {
		commandLine: string;
		cwdLabel?: string;
		cdPrefix?: string;
	};
	presentationOverrides?: {
		commandLine: string;
		language?: string;
	};
	alternativeRecommendation?: string;
	language: string;
	terminalToolSessionId?: string;
	isPty?: boolean;
	terminalCommandId?: string;
	isBackground?: boolean;
	autoApproveRuleResolvable?: boolean;
	requestUnsandboxedExecution?: boolean;
	requestUnsandboxedExecutionReason?: string;
	requestAllowNetwork?: boolean;
	requestAllowNetworkReason?: string;
	terminalCommandUri?: UriComponents;
	terminalCommandOutput?: {
		text: string;
		truncated?: boolean;
		lineCount?: number;
	};
	terminalTheme?: {
		background?: string;
		foreground?: string;
	};
	terminalCommandState?: {
		exitCode?: number;
		timestamp?: number;
		duration?: number;
	};
	didContinueInBackground?: boolean;
	autoApproveInfo?: IMarkdownString;
	missingSandboxDependencies?: string[];
	sandboxRemediations?: string[];
	sandboxPrerequisiteFailure?: string;
}

export interface ILegacyChatTerminalToolInvocationData {
	kind: 'terminal';
	command: string;
	language: string;
}

export function isLegacyChatTerminalToolInvocationData(data: unknown): data is ILegacyChatTerminalToolInvocationData {
	return !!data && typeof data === 'object' && 'command' in data && 'language' in data;
}

export type ChatMcpAppData =
	| {
		kind: 'local';
		resourceUri: string;
		serverDefinitionId: string;
		collectionId: string;
	}
	| {
		kind: 'agentHost';
		resourceUri: string;
		connectionAuthority: string;
		channel: string;
		serverId: string;
	};

export interface IChatToolInputInvocationData {
	kind: 'input';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rawInput: any;
	mcpAppData?: ChatMcpAppData;
	editable?: boolean;
}

export const enum ToolConfirmKind {
	Denied,
	ConfirmationNotNeeded,
	Setting,
	LmServicePerTool,
	UserAction,
	Skipped
}

export type ConfirmedReason =
	| { type: ToolConfirmKind.Denied }
	| { type: ToolConfirmKind.ConfirmationNotNeeded; reason?: string | IMarkdownString }
	| { type: ToolConfirmKind.Setting; id: string }
	| { type: ToolConfirmKind.LmServicePerTool; scope: 'session' | 'workspace' | 'profile' }
	| { type: ToolConfirmKind.UserAction; selectedButton?: string; selectedButtonKind?: ConfirmationOptionKind }
	| { type: ToolConfirmKind.Skipped };

export interface IChatToolInvocationOtherClientData {
	readonly cancel: () => void;
}

export interface IChatToolInvocation {
	readonly presentation: IPreparedToolInvocation['presentation'];
	readonly toolSpecificData?: IChatTerminalToolInvocationData | ILegacyChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatPullRequestContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatToolResourcesInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfigurationData | IChatAutomationConfiguredData;
	readonly otherClientToolCall?: IChatToolInvocationOtherClientData;
	readonly toolSpecificDataKind: IObservable<string | undefined>;
	readonly originMessage: string | IMarkdownString | undefined;
	readonly invocationMessage: string | IMarkdownString;
	readonly pastTenseMessage: string | IMarkdownString | undefined;
	readonly source: ToolDataSource;
	readonly toolId: string;
	readonly toolCallId: string;
	readonly subAgentInvocationId?: string;
	readonly icon?: ThemeIcon;
	readonly state: IObservable<IChatToolInvocation.State>;
	generatedTitle?: string;
	isAttachedToThinking: boolean;

	kind: 'toolInvocation';

	toJSON(): IChatToolInvocationSerialized;
}

export namespace IChatToolInvocation {
	export const enum StateKind {
		Streaming,
		WaitingForConfirmation,
		Executing,
		WaitingForPostApproval,
		Completed,
		Cancelled,
		WaitingForAuthentication,
	}

	interface IChatToolInvocationStateBase {
		type: StateKind;
	}

	export interface IChatToolInvocationStreamingState extends IChatToolInvocationStateBase {
		type: StateKind.Streaming;
		readonly partialInput: IObservable<unknown>;
		readonly streamingMessage: IObservable<string | IMarkdownString | undefined>;
	}

	interface IChatToolInvocationPostStreamState {
		readonly parameters: unknown;
		readonly confirmationMessages?: IToolConfirmationMessages;
	}

	interface IChatToolInvocationWaitingForConfirmationState extends IChatToolInvocationStateBase, IChatToolInvocationPostStreamState {
		type: StateKind.WaitingForConfirmation;
		confirm(reason: ConfirmedReason): void;
	}

	interface IChatToolInvocationPostConfirmState extends IChatToolInvocationPostStreamState {
		confirmed: ConfirmedReason;
	}

	interface IChatToolInvocationExecutingState extends IChatToolInvocationStateBase, IChatToolInvocationPostConfirmState {
		type: StateKind.Executing;
		progress: IObservable<{ message?: string | IMarkdownString; progress: number | undefined }>;
	}

	export interface IChatToolInvocationWaitingForAuthenticationState extends IChatToolInvocationStateBase, IChatToolInvocationPostConfirmState {
		type: StateKind.WaitingForAuthentication;
		readonly server: IChatMcpAuthenticationRequiredServer;
		cancel(): void;
	}

	interface IChatToolInvocationPostExecuteState extends IChatToolInvocationPostConfirmState {
		resultDetails: IToolResult['toolResultDetails'];
	}

	interface IChatToolWaitingForPostApprovalState extends IChatToolInvocationStateBase, IChatToolInvocationPostExecuteState {
		type: StateKind.WaitingForPostApproval;
		confirm(reason: ConfirmedReason): void;
		contentForModel: IToolResult['content'];
	}

	interface IChatToolInvocationCompleteState extends IChatToolInvocationStateBase, IChatToolInvocationPostExecuteState {
		type: StateKind.Completed;
		postConfirmed: ConfirmedReason | undefined;
		contentForModel: IToolResult['content'];
	}

	interface IChatToolInvocationCancelledState extends IChatToolInvocationStateBase, IChatToolInvocationPostStreamState {
		type: StateKind.Cancelled;
		reason: ToolConfirmKind.Denied | ToolConfirmKind.Skipped;
		reasonMessage?: string | IMarkdownString;
	}

	export type State =
		| IChatToolInvocationStreamingState
		| IChatToolInvocationWaitingForConfirmationState
		| IChatToolInvocationExecutingState
		| IChatToolInvocationWaitingForAuthenticationState
		| IChatToolWaitingForPostApprovalState
		| IChatToolInvocationCompleteState
		| IChatToolInvocationCancelledState;

	export function executionConfirmedOrDenied(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): ConfirmedReason | undefined {
		if (invocation.kind === 'toolInvocationSerialized') {
			if (invocation.isConfirmed === undefined || typeof invocation.isConfirmed === 'boolean') {
				return { type: invocation.isConfirmed ? ToolConfirmKind.UserAction : ToolConfirmKind.Denied };
			}
			return invocation.isConfirmed;
		}

		const state = invocation.state.read(reader);
		if (state.type === StateKind.Streaming || state.type === StateKind.WaitingForConfirmation) {
			return undefined;
		}
		if (state.type === StateKind.Cancelled) {
			return { type: state.reason };
		}

		return state.confirmed;
	}

	export function awaitConfirmation(invocation: IChatToolInvocation, token?: CancellationToken): Promise<ConfirmedReason> {
		const reason = executionConfirmedOrDenied(invocation);
		if (reason) {
			return Promise.resolve(reason);
		}

		const store = new DisposableStore();
		return new Promise<ConfirmedReason>(resolve => {
			if (token) {
				store.add(token.onCancellationRequested(() => {
					resolve({ type: ToolConfirmKind.Denied });
				}));
			}

			store.add(autorun(reader => {
				const reason = executionConfirmedOrDenied(invocation, reader);
				if (reason) {
					store.dispose();
					resolve(reason);
				}
			}));
		}).finally(() => {
			store.dispose();
		});
	}

	function postApprovalConfirmedOrDenied(invocation: IChatToolInvocation, reader?: IReader): ConfirmedReason | undefined {
		const state = invocation.state.read(reader);
		if (state.type === StateKind.Completed) {
			return state.postConfirmed || { type: ToolConfirmKind.ConfirmationNotNeeded };
		}
		if (state.type === StateKind.Cancelled) {
			return { type: state.reason };
		}

		return undefined;
	}

	export function confirmWith(invocation: IChatToolInvocation | undefined, reason: ConfirmedReason) {
		const state = invocation?.state.get();
		if (state?.type === StateKind.WaitingForConfirmation || state?.type === StateKind.WaitingForPostApproval) {
			state.confirm(reason);
			return true;
		}
		return false;
	}

	export function awaitPostConfirmation(invocation: IChatToolInvocation, token?: CancellationToken): Promise<ConfirmedReason> {
		const reason = postApprovalConfirmedOrDenied(invocation);
		if (reason) {
			return Promise.resolve(reason);
		}

		const store = new DisposableStore();
		return new Promise<ConfirmedReason>(resolve => {
			if (token) {
				store.add(token.onCancellationRequested(() => {
					resolve({ type: ToolConfirmKind.Denied });
				}));
			}

			store.add(autorun(reader => {
				const reason = postApprovalConfirmedOrDenied(invocation, reader);
				if (reason) {
					store.dispose();
					resolve(reason);
				}
			}));
		}).finally(() => {
			store.dispose();
		});
	}

	export function resultDetails(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader) {
		if (invocation.kind === 'toolInvocationSerialized') {
			return invocation.resultDetails;
		}

		const state = invocation.state.read(reader);
		if (state.type === StateKind.Completed || state.type === StateKind.WaitingForPostApproval) {
			return state.resultDetails;
		}

		return undefined;
	}

	export function isComplete(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean {
		if (invocation.kind === 'toolInvocationSerialized') {
			return true;
		}

		const state = invocation.state.read(reader);
		return state.type === StateKind.Completed || state.type === StateKind.Cancelled;
	}

	export function isEffectivelyHidden(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean {
		if (invocation.presentation === 'hidden') {
			return true;
		}
		if (invocation.presentation === 'hiddenAfterComplete' && isComplete(invocation, reader)) {
			return true;
		}
		return false;
	}

	export function isStreaming(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): boolean {
		if (invocation.kind === 'toolInvocationSerialized') {
			return false;
		}

		const state = invocation.state.read(reader);
		return state.type === StateKind.Streaming;
	}

	export function getParameters(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): unknown | undefined {
		if (invocation.kind === 'toolInvocationSerialized') {
			return undefined;
		}

		const state = invocation.state.read(reader);
		if (state.type === StateKind.Streaming) {
			return undefined;
		}

		return state.parameters;
	}

	export function getConfirmationMessages(invocation: IChatToolInvocation | IChatToolInvocationSerialized, reader?: IReader): IToolConfirmationMessages | undefined {
		if (invocation.kind === 'toolInvocationSerialized') {
			return undefined;
		}

		const state = invocation.state.read(reader);
		if (state.type === StateKind.Streaming) {
			return undefined;
		}

		return state.confirmationMessages;
	}
}


export interface IToolResultOutputDetailsSerialized {
	output: {
		type: 'data';
		mimeType: string;
		base64Data: string;
	};
}

export interface IChatToolInvocationSerialized {
	presentation: IPreparedToolInvocation['presentation'];
	toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatPullRequestContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatSimpleToolInvocationData | IChatSearchToolInvocationData | IChatToolResourcesInvocationData | IChatModifiedFilesConfirmationData | IChatAgentFeedbackReviewConfirmationData | IChatSessionCreatedData | IChatGeneratedImageData | IChatAutomationConfiguredData;
	invocationMessage: string | IMarkdownString;
	originMessage: string | IMarkdownString | undefined;
	pastTenseMessage: string | IMarkdownString | undefined;
	resultDetails?: Array<URI | Location> | IToolResultInputOutputDetails | IToolResultOutputDetailsSerialized;
	isConfirmed: ConfirmedReason | boolean | undefined;
	isComplete: boolean;
	toolCallId: string;
	toolId: string;
	readonly icon?: undefined;
	source: ToolDataSource | undefined;
	readonly subAgentInvocationId?: string;
	generatedTitle?: string;
	isAttachedToThinking?: boolean;
	kind: 'toolInvocationSerialized';
}

export interface IChatExtensionsContent {
	extensions: string[];
	kind: 'extensions';
}

export interface IChatPullRequestContent {
	uri?: URI;
	command: Command;
	title: string;
	description: string;
	author: string;
	linkTag: string;
	kind: 'pullRequest';
}

export interface IChatSubagentToolInvocationData {
	kind: 'subagent';
	isActive?: boolean;
	activity?: 'markdown' | 'reasoning';
	description?: string;
	agentDisplayName?: string;
	agentName?: string;
	prompt?: string;
	result?: string;
	modelName?: string;
	credits?: number;
	startedAt?: number;
	duration?: number;
	chatResource?: string;
}

export interface IChatExternalToolInvocationUpdate {
	kind: 'externalToolInvocationUpdate';
	toolCallId: string;
	toolName: string;
	isComplete: boolean;
	errorMessage?: string;
	invocationMessage?: string | IMarkdownString;
	pastTenseMessage?: string | IMarkdownString;
	toolSpecificData?: IChatTerminalToolInvocationData | IChatToolInputInvocationData | IChatExtensionsContent | IChatTodoListContent | IChatSubagentToolInvocationData | IChatModifiedFilesConfirmationData;
	subagentInvocationId?: string;
	resultDetails?: IToolResultInputOutputDetails;
}

export interface IChatTodoListContent {
	kind: 'todoList';
	todoList: Array<{
		id: string;
		title: string;
		status: 'not-started' | 'in-progress' | 'completed';
	}>;
}

export interface IChatSimpleToolInvocationData {
	kind: 'simpleToolInvocation';
	input: string;
	output: string;
}

export interface IChatSearchToolInvocationData {
	readonly kind: 'search';
}

export interface IChatToolResourcesInvocationData {
	readonly kind: 'resources';
	readonly values: Array<URI | Location>;
}

export interface IChatSessionCreatedData {
	readonly kind: 'sessionCreated';
	readonly openLink: string;
	readonly label: string;
	readonly fullTitle?: string;
	readonly isChat?: boolean;
}

export interface IChatGeneratedImageData {
	readonly kind: 'generatedImage';
}

export interface IChatAutomationConfiguredData {
	readonly kind: 'automationConfigured';
	readonly automationId: string;
	readonly automationName: string;
	readonly operation: 'created' | 'updated';
}

export interface IChatAutomationConfigurationData {
	readonly kind: 'automationConfiguration';
	readonly expectedAutomationId: string;
	readonly expectedEditableState: string;
}

export interface IChatModifiedFilesConfirmationData {
	readonly kind: 'modifiedFilesConfirmation';
	readonly options: readonly string[];
	readonly modifiedFiles: readonly {
		readonly uri: UriComponents;
		readonly editKind?: ChatExternalEditKind;
		readonly originalUri?: UriComponents;
		readonly modifiedContentUri?: UriComponents;
		readonly originalContentUri?: UriComponents;
		readonly insertions?: number;
		readonly deletions?: number;
		readonly title?: string;
		readonly description?: string;
	}[];
}

export interface IChatAgentFeedbackReviewConfirmationData {
	readonly kind: 'agentFeedbackReviewConfirmation';
	readonly options: readonly string[];
}

export interface IChatAgentFeedbackReviewComment {
	readonly id: string;
	readonly kindLabel?: string;
	readonly text: string;
	readonly fileUri: UriComponents;
}

export interface IChatAgentFeedbackPullRequestThreadLink {
	readonly pullRequestThreadId: string;
	readonly commentId: string;
}

export const enum AgentFeedbackReviewCommandId {
	GetComments = '_agentFeedbackReview.getComments',
	GetPullRequestThreadLinks = '_agentFeedbackReview.getPullRequestThreadLinks',
	Reveal = '_agentFeedbackReview.reveal',
	RevealAt = '_agentFeedbackReview.revealAt',
	Delete = '_agentFeedbackReview.delete',
	Accept = '_agentFeedbackReview.accept',
}

export interface IChatMcpServersStarting {
	readonly kind: 'mcpServersStarting';
	readonly state?: IObservable<IAutostartResult>;
	didStartServerIds?: string[];
	toJSON(): IChatMcpServersStartingSerialized;
}

export interface IChatMcpServersStartingSerialized {
	readonly kind: 'mcpServersStarting';
	readonly state?: undefined;
	didStartServerIds?: string[];
}

export interface IChatMcpAuthenticationRequired {
	readonly kind: 'mcpAuthenticationRequired';
	readonly sessionResource: UriComponents;
	readonly servers: IObservable<readonly IChatMcpAuthenticationRequiredServer[]>;
	isUsed: boolean;
}

export interface IChatMcpAuthenticationRequiredServer {
	readonly id: string;
	readonly name: string;
	readonly resource: string;
	readonly oauthClient?: McpOAuthClient;
	readonly authorizationServers?: readonly string[];
	readonly supportedScopes?: readonly string[];
	readonly requiredScopes?: readonly string[];
	readonly reason?: string;
}

export interface IChatMcpServersStartingSlow {
	readonly kind: 'mcpServersStartingSlow';
	readonly sessionResource: UriComponents;
	readonly servers: IObservable<readonly IChatMcpStartingServer[]>;
}

export interface IChatMcpStartingServer {
	readonly id: string;
	readonly name: string;
}

export interface IChatDisabledClaudeHooksPart {
	readonly kind: 'disabledClaudeHooks';
}

export interface IChatPlanApprovalAction {
	id?: string;
	label: string;
	description?: string;
	default?: boolean;
	permissionLevel?: 'autopilot';
}

export interface IChatPlanReviewResult {
	action?: string;
	actionId?: string;
	rejected: boolean;
	feedback?: string;
	feedbackOverall?: string;
	feedbackInlineMarkdown?: string;
}

export interface IChatPlanReview {
	kind: 'planReview';
	title: string;
	content: string;
	actions: IChatPlanApprovalAction[];
	canProvideFeedback: boolean;
	planUri?: UriComponents;
	resolveId?: string;
	data?: IChatPlanReviewResult;
	isUsed?: boolean;
	isOutdated?: boolean;
	source?: ToolDataSource;
}

export class ChatMcpServersStarting implements IChatMcpServersStarting {
	public readonly kind = 'mcpServersStarting';

	public didStartServerIds?: string[] = [];

	public get isEmpty() {
		const s = this.state.get();
		return !s.working && s.serversRequiringInteraction.length === 0;
	}

	constructor(public readonly state: IObservable<IAutostartResult>) { }

	wait() {
		return new Promise<IAutostartResult>(resolve => {
			autorunSelfDisposable(reader => {
				const s = this.state.read(reader);
				if (!s.working) {
					reader.dispose();
					resolve(s);
				}
			});
		});
	}

	toJSON(): IChatMcpServersStartingSerialized {
		return { kind: 'mcpServersStarting', didStartServerIds: this.didStartServerIds };
	}
}

export type IChatProgress =
	| IChatMarkdownContent
	| IChatAgentMarkdownContentWithVulnerability
	| IChatUsage
	| IChatTreeData
	| IChatMultiDiffData
	| IChatMultiDiffDataSerialized
	| IChatUsedContext
	| IChatContentReference
	| IChatContentInlineReference
	| IChatCodeCitation
	| IChatProgressMessage
	| IChatSystemNotificationPart
	| IChatTask
	| IChatTaskResult
	| IChatCommandButton
	| IChatWarningMessage
	| IChatInfoMessage
	| IChatTextEdit
	| IChatNotebookEdit
	| IChatWorkspaceEdit
	| IChatExternalEdit
	| IChatMoveMessage
	| IChatResponseCodeblockUriPart
	| IChatConfirmation
	| IChatQuestionCarousel
	| IChatPlanReview
	| IChatClearToPreviousToolInvocation
	| IChatToolInvocation
	| IChatToolInvocationSerialized
	| IChatExtensionsContent
	| IChatPullRequestContent
	| IChatUndoStop
	| IChatThinkingPart
	| IChatVoiceProgressPart
	| IChatTaskSerialized
	| IChatElicitationRequest
	| IChatElicitationRequestSerialized
	| IChatMcpServersStarting
	| IChatMcpServersStartingSerialized
	| IChatMcpAuthenticationRequired
	| IChatMcpServersStartingSlow
	| IChatHookPart
	| IChatExternalToolInvocationUpdate
	| IChatDisabledClaudeHooksPart
	| IChatAutoModeResolutionPart;

export interface IChatFollowup {
	kind: 'reply';
	message: string;
	agentId: string;
	subCommand?: string;
	title?: string;
	tooltip?: string;
}

export function isChatFollowup(obj: unknown): obj is IChatFollowup {
	return (
		!!obj &&
		(obj as IChatFollowup).kind === 'reply' &&
		typeof (obj as IChatFollowup).message === 'string' &&
		typeof (obj as IChatFollowup).agentId === 'string'
	);
}

export enum ChatAgentVoteDirection {
	Down = 0,
	Up = 1
}

export interface IChatVoteAction {
	kind: 'vote';
	direction: ChatAgentVoteDirection;
}

export enum ChatCopyKind {
	Action = 1,
	Toolbar = 2
}

export interface IChatCopyAction {
	kind: 'copy';
	codeBlockIndex: number;
	copyKind: ChatCopyKind;
	copiedCharacters: number;
	totalCharacters: number;
	copiedText: string;
	totalLines: number;
	copiedLines: number;
	modelId: string;
	languageId?: string;
}

export interface IChatInsertAction {
	kind: 'insert';
	codeBlockIndex: number;
	totalCharacters: number;
	totalLines: number;
	languageId?: string;
	modelId: string;
	newFile?: boolean;
}

export interface IChatApplyAction {
	kind: 'apply';
	codeBlockIndex: number;
	totalCharacters: number;
	totalLines: number;
	languageId?: string;
	modelId: string;
	newFile?: boolean;
	codeMapper?: string;
	editsProposed: boolean;
}


export interface IChatTerminalAction {
	kind: 'runInTerminal';
	codeBlockIndex: number;
	languageId?: string;
}

export interface IChatCommandAction {
	kind: 'command';
	commandButton: IChatCommandButton;
}

export interface IChatFollowupAction {
	kind: 'followUp';
	followup: IChatFollowup;
}

export interface IChatBugReportAction {
	kind: 'bug';
}

export interface IChatInlineChatCodeAction {
	kind: 'inlineChat';
	action: 'accepted' | 'discarded';
}


export interface IChatEditingSessionAction {
	kind: 'chatEditingSessionAction';
	uri: URI;
	hasRemainingEdits: boolean;
	outcome: 'accepted' | 'rejected' | 'userModified';
}

export interface IChatEditingHunkAction {
	kind: 'chatEditingHunkAction';
	uri: URI;
	lineCount: number;
	linesAdded: number;
	linesRemoved: number;
	outcome: 'accepted' | 'rejected';
	hasRemainingEdits: boolean;
	modeId?: string;
	modelId?: string;
	languageId?: string;
}

export type ChatUserAction = IChatVoteAction | IChatCopyAction | IChatInsertAction | IChatApplyAction | IChatTerminalAction | IChatCommandAction | IChatFollowupAction | IChatBugReportAction | IChatInlineChatCodeAction | IChatEditingSessionAction | IChatEditingHunkAction;

export interface IChatUserActionEvent {
	action: ChatUserAction;
	agentId: string | undefined;
	command: string | undefined;
	sessionResource: URI;
	requestId: string;
	result: IChatAgentResult | undefined;
	modelId?: string | undefined;
	modeId?: string | undefined;
}

export interface IChatDynamicRequest {
	message: string;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	metadata?: any;
}

export interface IChatCompleteResponse {
	message: string | ReadonlyArray<IChatProgress>;
	result?: IChatAgentResult;
	followups?: IChatFollowup[];
}

export interface IChatSessionStats {
	readonly fileCount: number;
	readonly added: number;
	readonly removed: number;
}

export type IChatSessionTiming = {
	readonly created: number;

	readonly lastRequestStarted: number | undefined;

	readonly lastRequestEnded: number | undefined;
};

interface ILegacyChatSessionTiming {
	readonly startTime: number;
	readonly endTime?: number;
}

export function convertLegacyChatSessionTiming(timing: IChatSessionTiming | ILegacyChatSessionTiming): IChatSessionTiming {
	if (hasKey(timing, { created: true })) {
		return timing;
	}
	return {
		created: timing.startTime,
		lastRequestStarted: timing.startTime,
		lastRequestEnded: timing.endTime,
	};
}

export const enum ResponseModelState {
	Pending,
	Complete,
	Cancelled,
	Failed,
	NeedsInput,
}

export interface IChatDetail {
	sessionResource: URI;
	title: string;
	lastMessageDate: number;
	timing: IChatSessionTiming | ILegacyChatSessionTiming;
	isActive: boolean;
	stats?: IChatSessionStats;
	lastResponseState: ResponseModelState;
	isEmpty?: boolean;
	workingDirectory?: URI;
}

export interface IChatProviderInfo {
	id: string;
}

export interface IChatSendRequestResponseState {
	responseCreatedPromise: Promise<IChatResponseModel>;
	responseCompletePromise: Promise<void>;
}

export interface IChatSendRequestData extends IChatSendRequestResponseState {
	agent: IChatAgentData;
	slashCommand?: IChatAgentCommand;
}

export type ChatSendResult =
	| ChatSendResultRejected
	| ChatSendResultSent
	| ChatSendResultQueued;

export interface ChatSendResultRejected {
	readonly kind: 'rejected';
	readonly reason: string;
	readonly reasonCode?: 'cancelled' | 'providerRemoved';
	readonly newSessionResource?: URI;
}

export interface ChatSendResultSent {
	readonly kind: 'sent';
	readonly data: IChatSendRequestData;
	readonly newSessionResource?: URI;
}

export interface ChatSendResultQueued {
	readonly kind: 'queued';
	readonly requestId: string;
	readonly deferred: Promise<ChatSendResult>;
}

export namespace ChatSendResult {
	export function isSent(result: ChatSendResult): result is ChatSendResultSent {
		return result.kind === 'sent';
	}

	export function isRejected(result: ChatSendResult): result is ChatSendResultRejected {
		return result.kind === 'rejected';
	}

	export function isQueued(result: ChatSendResult): result is ChatSendResultQueued {
		return result.kind === 'queued';
	}

	export function assertSent(result: ChatSendResult): asserts result is ChatSendResultSent {
		if (result.kind !== 'sent') {
			throw new Error(`Expected ChatSendResult to be 'sent', but was '${result.kind}'`);
		}
	}
}

export interface IChatEditorLocationData {
	type: ChatAgentLocation.EditorInline;
	id: string;
	document: URI;
	selection: ISelection;
	wholeRange: IRange;
}

export interface IChatNotebookLocationData {
	type: ChatAgentLocation.Notebook;
	sessionInputUri: URI;
}

export interface IChatTerminalLocationData {
	type: ChatAgentLocation.Terminal;
}

export type IChatLocationData = IChatEditorLocationData | IChatNotebookLocationData | IChatTerminalLocationData;

export const enum ChatRequestQueueKind {
	Queued = 'queued',
	Steering = 'steering'
}

export interface IRemotePendingRequest {
	readonly id: string;
	readonly kind: ChatRequestQueueKind;
	readonly message: string;
	readonly variableData?: IChatRequestVariableData;
	readonly timestamp?: number;
}

export interface IChatSendRequestOptions {
	modeInfo?: IChatRequestModeInfo;
	isVoiceModeInput?: boolean;
	userSelectedModelId?: string;






	userSelectedModelConfiguration?: IStringDictionary<unknown>;
	userSelectedTools?: IObservable<UserSelectedTools>;
	location?: ChatAgentLocation;
	locationData?: IChatLocationData;
	parserContext?: IChatParserContext;
	attempt?: number;
	noCommandDetection?: boolean;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	acceptedConfirmationData?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	rejectedConfirmationData?: any[];
	attachedContext?: IChatRequestVariableEntry[];
	resolvedVariables?: IChatRequestVariableEntry[];
	agentHostSessionConfig?: Record<string, unknown>;

	agentId?: string;
	agentIdSilent?: string;
	slashCommand?: string;

	confirmation?: string;

	queue?: ChatRequestQueueKind;

	pauseQueue?: boolean;

	isSystemInitiated?: boolean;

	hideFromTranscript?: boolean;

	systemInitiatedLabel?: string;

	terminalExecutionId?: string;

	instructionContext?: {
		modeKind: ChatModeKind;
		enabledTools?: UserSelectedTools;
		enabledSubAgents?: readonly string[];
	};
}

export type IChatModelReference = IReference<IChatModel>;

export interface IChatRequestSubmittedEvent {
	readonly chatSessionResource: URI;
	readonly message?: IParsedChatRequest;
	readonly attachedContext?: IChatRequestVariableEntry[];
}

export const IChatService = createDecorator<IChatService>('IChatService');

export interface IChatService {
	_serviceBrand: undefined;
	transferredSessionResource: URI | undefined;

	readonly onDidSubmitRequest: Event<IChatRequestSubmittedEvent>;

	readonly onDidCreateModel: Event<IChatModel>;

	registerCustomizationMigrationHintProvider(provider: (sessionResource: URI, token: CancellationToken) => Promise<ICustomizationMigrationHint | undefined>): IDisposable;

	readonly chatModels: IObservable<Iterable<IChatModel>>;

	readonly editingSessions: readonly IChatEditingSession[];

	isEnabled(location: ChatAgentLocation): boolean;

	hasSessions(): boolean;

	startNewLocalSession(location: ChatAgentLocation, options?: IChatSessionStartOptions): IChatModelReference;

	getSession(sessionResource: URI): IChatModel | undefined;

	acquireExistingSession(sessionResource: URI, debugOwner?: string): IChatModelReference | undefined;

	acquireOrLoadSession(sessionResource: URI, location: ChatAgentLocation, token: CancellationToken, debugOwner?: string, sessionTypeSelectionReason?: SessionTypeSelectionReason): Promise<IChatModelReference | undefined>;




	loadSessionFromData(data: IExportableChatData | ISerializableChatData, debugOwner?: string, sessionTypeSelectionReason?: SessionTypeSelectionReason): IChatModelReference;

	getChatModelReferenceDebugInfo(): IChatModelReferenceDebugSnapshot;

	sendRequest(sessionResource: URI, message: string, options?: IChatSendRequestOptions): Promise<ChatSendResult>;

	getSessionTitle(sessionResource: URI): string | undefined;
	setSessionTitle(sessionResource: URI, title: string): void;

	appendProgress(request: IChatRequestModel, progress: IChatProgress): void;
	resendRequest(request: IChatRequestModel, options?: IChatSendRequestOptions, preserveRequestId?: boolean): Promise<void>;
	adoptRequest(sessionResource: URI, request: IChatRequestModel): Promise<void>;
	removeRequest(sessionResource: URI, requestId: string): Promise<void>;
	cancelCurrentRequestForSession(sessionResource: URI, source?: string): Promise<void>;
	migrateRequests(originalResource: URI, targetResource: URI): void;
	setYieldRequested(sessionResource: URI): void;
	removePendingRequest(sessionResource: URI, requestId: string): void;
	setPendingRequests(sessionResource: URI, requests: readonly { requestId: string; kind: ChatRequestQueueKind }[]): void;
	syncPendingRequestsFromRemote(sessionResource: URI, requests: readonly IRemotePendingRequest[]): void;
	processPendingRequests(sessionResource: URI): void;
	sendPendingRequestImmediately(sessionResource: URI, requestId: string): Promise<void>;
	addCompleteRequest(sessionResource: URI, message: IParsedChatRequest | string, variableData: IChatRequestVariableData | undefined, attempt: number | undefined, response: IChatCompleteResponse): void;
	setChatSessionTitle(sessionResource: URI, title: string): void;
	getLocalSessionHistory(): Promise<IChatDetail[]>;
	clearAllHistoryEntries(): Promise<void>;
	removeHistoryEntry(sessionResource: URI): Promise<void>;
	getChatStorageFolder(): URI;
	logChatIndex(): void;
	getLiveSessionItems(): Promise<IChatDetail[]>;
	getHistorySessionItems(): Promise<IChatDetail[]>;
	getMetadataForSession(sessionResource: URI): Promise<IChatDetail | undefined>;

	readonly onDidPerformUserAction: Event<IChatUserActionEvent>;
	notifyUserAction(event: IChatUserActionEvent): void;

	readonly onDidReceiveQuestionCarouselAnswer: Event<{ requestId: string; resolveId: string; answers: IChatQuestionAnswers | undefined }>;
	notifyQuestionCarouselAnswer(requestId: string, resolveId: string, answers: IChatQuestionAnswers | undefined): void;

	readonly onDidDisposeSession: Event<{ readonly sessionResources: readonly URI[]; readonly reason: 'cleared' }>;

	transferChatSession(transferredSessionResource: URI, toWorkspace: URI): Promise<void>;

	activateDefaultAgent(location: ChatAgentLocation): Promise<void>;

	readonly requestInProgressObs: IObservable<boolean>;

	getPendingRequestSessionTypes(): readonly string[];

	setSaveModelsEnabled(enabled: boolean): void;

	waitForModelDisposals(): Promise<void>;
}

export interface IChatSessionContext {
	readonly initialSessionOptions?: ReadonlyChatSessionOptionsMap;
}

export const KEYWORD_ACTIVIATION_SETTING_ID = 'accessibility.voice.keywordActivation';

export interface IChatSessionStartOptions {
	canUseTools?: boolean;
	disableBackgroundKeepAlive?: boolean;
	debugOwner?: string;
	sessionTypeSelectionReason?: SessionTypeSelectionReason;
}

export const ChatStopCancellationNoopEventName = 'chat.stopCancellationNoop';

export type ChatStopCancellationNoopEvent = {
	source: string;
	reason: 'noWidget' | 'noViewModel' | 'noPendingRequest' | 'requestAlreadyCanceled' | 'requestIdUnavailable';
	requestInProgress: 'true' | 'false' | 'unknown';
	pendingRequests: number;
	sessionScheme?: string;
	lastRequestId?: string;
	chatSessionId?: string;
};

export type ChatStopCancellationNoopClassification = {
	source: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The layer where stop cancellation no-op occurred.' };
	reason: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The no-op reason when stop cancellation did not dispatch fully.' };
	requestInProgress: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether request-in-progress was true, false, or unknown at no-op time.' };
	pendingRequests: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The number of queued pending requests at no-op time when known.'; isMeasurement: true };
	sessionScheme?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The URI scheme of the session resource (e.g. vscodeLocalChatSession vs remote).' };
	lastRequestId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the last request in the session, for correlating with tool invocations.' };
	chatSessionId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The chat session ID.' };
	owner: 'roblourens';
	comment: 'Tracks possible no-op stop cancellation paths.';
};

export const ChatPendingRequestChangeEventName = 'chat.pendingRequestChange';

export type ChatPendingRequestChangeEvent = {
	action: 'add' | 'remove' | 'notCancelable';
	source: string;
	requestId?: string;
	chatSessionId?: string;
};

export type ChatPendingRequestChangeClassification = {
	action: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether a pending request was added or removed.' };
	source: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The method that triggered the pending request change.' };
	requestId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The request ID associated with the pending request change.' };
	chatSessionId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The chat session ID.' };
	owner: 'roblourens';
	comment: 'Tracks pending request lifecycle changes in the chat service.';
};
