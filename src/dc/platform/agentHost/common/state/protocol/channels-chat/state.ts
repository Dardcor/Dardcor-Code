/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ModelSelection } from '../channels-root/state.js';
import type { AgentSelection, McpAuthRequirement, SessionStatus } from '../channels-session/state.js';
import type { ContentRef, ErrorInfo, FileEdit, StringOrMarkdown, TextRange, TextSelection, URI, UsageInfo } from '../common/state.js';


export interface ChatState {
	resource: URI;
	title: string;
	status: SessionStatus;
	activity?: string;
	modifiedAt: string;
	origin?: ChatOrigin;
	interactivity?: ChatInteractivity;
	workingDirectories?: URI[];

	turns: Turn[];
	turnsNextCursor?: string;
	activeTurn?: ActiveTurn;
	steeringMessage?: PendingMessage;
	queuedMessages?: PendingMessage[];
	draft?: Message;
	_meta?: Record<string, unknown>;
}

export interface ChatSummary {
	resource: URI;
	title: string;
	status: SessionStatus;
	activity?: string;
	modifiedAt: string;
	origin?: ChatOrigin;
	interactivity?: ChatInteractivity;
	workingDirectories?: URI[];
}

export const enum ChatOriginKind {
	User = 'user',
	Fork = 'fork',
	SideChat = 'sideChat',
	Tool = 'tool',
}

export interface SideChatSelection {
	text: string;
	responsePartId?: string;
}

export type ChatOrigin =
	| { kind: ChatOriginKind.User }
	| { kind: ChatOriginKind.Fork; chat: URI; turnId: string }
	| { kind: ChatOriginKind.SideChat; chat: URI; turnId: string; selection?: SideChatSelection }
	| { kind: ChatOriginKind.Tool; chat: URI; toolCallId: string };

export const enum ChatInteractivity {
	Full = 'full',
	ReadOnly = 'read-only',
	Hidden = 'hidden',
}


export const enum PendingMessageKind {
	Steering = 'steering',
	Queued = 'queued',
}

export interface PendingMessage {
	id: string;
	message: Message;
}



export const enum ChatInputResponseKind {
	Accept = 'accept',
	Decline = 'decline',
	Cancel = 'cancel',
}

export const enum ChatInputQuestionKind {
	Text = 'text',
	Number = 'number',
	Integer = 'integer',
	Boolean = 'boolean',
	SingleSelect = 'single-select',
	MultiSelect = 'multi-select',
}

export interface ChatInputOption {
	id: string;
	label: string;
	description?: string;
	recommended?: boolean;
}

interface ChatInputQuestionBase {
	id: string;
	title?: string;
	message: string;
	required?: boolean;
}

export interface ChatInputTextQuestion extends ChatInputQuestionBase {
	kind: ChatInputQuestionKind.Text;
	format?: string;
	min?: number;
	max?: number;
	defaultValue?: string;
}

export interface ChatInputNumberQuestion extends ChatInputQuestionBase {
	kind: ChatInputQuestionKind.Number | ChatInputQuestionKind.Integer;
	min?: number;
	max?: number;
	defaultValue?: number;
}

export interface ChatInputBooleanQuestion extends ChatInputQuestionBase {
	kind: ChatInputQuestionKind.Boolean;
	defaultValue?: boolean;
}

export interface ChatInputSingleSelectQuestion extends ChatInputQuestionBase {
	kind: ChatInputQuestionKind.SingleSelect;
	options: ChatInputOption[];
	allowFreeformInput?: boolean;
}

export interface ChatInputMultiSelectQuestion extends ChatInputQuestionBase {
	kind: ChatInputQuestionKind.MultiSelect;
	options: ChatInputOption[];
	allowFreeformInput?: boolean;
	min?: number;
	max?: number;
}

export type ChatInputQuestion = ChatInputTextQuestion
	| ChatInputNumberQuestion
	| ChatInputBooleanQuestion
	| ChatInputSingleSelectQuestion
	| ChatInputMultiSelectQuestion;

export interface ChatInputRequest {
	id: string;
	message?: string;
	url?: URI;
	questions?: ChatInputQuestion[];
	answers?: Record<string, ChatInputAnswer>;
}

export const enum ChatInputAnswerValueKind {
	Text = 'text',
	Number = 'number',
	Boolean = 'boolean',
	Selected = 'selected',
	SelectedMany = 'selected-many',
}

export interface ChatInputTextAnswerValue {
	kind: ChatInputAnswerValueKind.Text;
	value: string;
}

export interface ChatInputNumberAnswerValue {
	kind: ChatInputAnswerValueKind.Number;
	value: number;
}

export interface ChatInputBooleanAnswerValue {
	kind: ChatInputAnswerValueKind.Boolean;
	value: boolean;
}

export interface ChatInputSelectedAnswerValue {
	kind: ChatInputAnswerValueKind.Selected;
	value: string;
	freeformValues?: string[];
}

export interface ChatInputSelectedManyAnswerValue {
	kind: ChatInputAnswerValueKind.SelectedMany;
	value: string[];
	freeformValues?: string[];
}

export type ChatInputAnswerValue = ChatInputTextAnswerValue
	| ChatInputNumberAnswerValue
	| ChatInputBooleanAnswerValue
	| ChatInputSelectedAnswerValue
	| ChatInputSelectedManyAnswerValue;

export interface ChatInputAnswered {
	state: ChatInputAnswerState.Draft | ChatInputAnswerState.Submitted;
	value: ChatInputAnswerValue;
}

export interface ChatInputSkipped {
	state: ChatInputAnswerState.Skipped;
	freeformValues?: string[];
}

export const enum ChatInputAnswerState {
	Draft = 'draft',
	Submitted = 'submitted',
	Skipped = 'skipped',
}

export type ChatInputAnswer = ChatInputAnswered | ChatInputSkipped;



export const enum TurnState {
	Complete = 'complete',
	Cancelled = 'cancelled',
	Error = 'error',
}

export const enum MessageAttachmentKind {
	Simple = 'simple',
	EmbeddedResource = 'embeddedResource',
	Resource = 'resource',
	Annotations = 'annotations',
	Chat = 'chat',
}

export interface Turn {
	id: string;
	startedAt?: string;
	duration?: number;
	message: Message;
	responseParts: ResponsePart[];
	usage: UsageInfo | undefined;
	state: TurnState;
}

export interface ActiveTurn {
	id: string;
	startedAt: string;
	message: Message;
	responseParts: ResponsePart[];
	usage: UsageInfo | undefined;
}

export enum MessageKind {
	User = 'user',
	Agent = 'agent',
	Tool = 'tool',
	Automation = 'automation',
	SystemNotification = 'systemNotification',
}

export interface MessageOrigin {
	kind: MessageKind;
}

export interface Message {
	text: string;
	origin: MessageOrigin;
	attachments?: MessageAttachment[];
	model?: ModelSelection;
	agent?: AgentSelection;
	_meta?: Record<string, unknown>;
}

export interface MessageAttachmentBase {
	label: string;

	range?: TextRange;

	displayKind?: string;

	_meta?: Record<string, unknown>;
}

export interface SimpleMessageAttachment extends MessageAttachmentBase {
	type: MessageAttachmentKind.Simple;

	modelRepresentation?: string;
}

export interface MessageEmbeddedResourceAttachment extends MessageAttachmentBase {
	type: MessageAttachmentKind.EmbeddedResource;
	data: string;
	contentType: string;
	selection?: TextSelection;
}

export interface MessageResourceAttachment extends MessageAttachmentBase, ContentRef {
	type: MessageAttachmentKind.Resource;
	selection?: TextSelection;
}

export interface MessageAnnotationsAttachment extends MessageAttachmentBase {
	type: MessageAttachmentKind.Annotations;
	resource: URI;
	annotationIds?: string[];
}

export interface MessageChatAttachment extends MessageAttachmentBase {
	type: MessageAttachmentKind.Chat;
	resource: URI;
	endTurn?: string;
}

export type MessageAttachment =
	| SimpleMessageAttachment
	| MessageEmbeddedResourceAttachment
	| MessageResourceAttachment
	| MessageAnnotationsAttachment
	| MessageChatAttachment;


export const enum ResponsePartKind {
	Markdown = 'markdown',
	ContentRef = 'contentRef',
	ToolCall = 'toolCall',
	Reasoning = 'reasoning',
	SystemNotification = 'systemNotification',
	InputRequest = 'inputRequest',
	Error = 'error',
}

export interface MarkdownResponsePart {
	kind: ResponsePartKind.Markdown;
	id: string;
	content: string;
}

export interface ResourceResponsePart extends ContentRef {
	kind: ResponsePartKind.ContentRef;
}

export interface ToolCallResponsePart {
	kind: ResponsePartKind.ToolCall;
	toolCall: ToolCallState;
}

export interface ReasoningResponsePart {
	kind: ResponsePartKind.Reasoning;
	id: string;
	content: string;
}

export type ResponsePart =
	| MarkdownResponsePart
	| ResourceResponsePart
	| ToolCallResponsePart
	| ReasoningResponsePart
	| SystemNotificationResponsePart
	| InputRequestResponsePart
	| ErrorResponsePart;

export interface InputRequestResponsePart {
	kind: ResponsePartKind.InputRequest;
	request: ChatInputRequest;
	response?: ChatInputResponseKind;
}

export interface ErrorResponsePart {
	kind: ResponsePartKind.Error;
	error: ErrorInfo;
	resumable?: boolean;
}

export interface SystemNotificationResponsePart {
	kind: ResponsePartKind.SystemNotification;
	content: StringOrMarkdown;
	_meta?: Record<string, unknown>;
}



export const enum ToolCallStatus {
	Streaming = 'streaming',
	PendingConfirmation = 'pending-confirmation',
	Running = 'running',
	AuthRequired = 'auth-required',
	PendingResultConfirmation = 'pending-result-confirmation',
	Completed = 'completed',
	Cancelled = 'cancelled',
}

export const enum ToolCallConfirmationReason {
	NotNeeded = 'not-needed',
	UserAction = 'user-action',
	Setting = 'setting',
}

export const enum ToolCallRiskAssessmentKind {
	Judge = 'judge',
}

export const enum ToolCallRiskAssessmentStatus {
	Loading = 'loading',
	Complete = 'complete',
}

interface ToolCallRiskAssessmentBase {
	kind: ToolCallRiskAssessmentKind;
}

export interface ToolCallRiskAssessmentLoadingState extends ToolCallRiskAssessmentBase {
	status: ToolCallRiskAssessmentStatus.Loading;
}

export interface ToolCallRiskAssessmentCompleteState extends ToolCallRiskAssessmentBase {
	status: ToolCallRiskAssessmentStatus.Complete;
	reason: StringOrMarkdown;
	safety: number;
}

export type ToolCallRiskAssessment =
	| ToolCallRiskAssessmentLoadingState
	| ToolCallRiskAssessmentCompleteState;

export const enum ToolCallCancellationReason {
	Denied = 'denied',
	Skipped = 'skipped',
	ResultDenied = 'result-denied',
}

export const enum ConfirmationOptionKind {
	Approve = 'approve',
	Deny = 'deny',
}

export interface ConfirmationOption {
	id: string;
	label: string;
	kind: ConfirmationOptionKind;
	group?: number;
}

export const enum ToolCallContributorKind {
	Client = 'client',
	MCP = 'mcp',
}

export interface ToolCallClientContributor {
	kind: ToolCallContributorKind.Client;
	clientId: string;
}

export interface ToolCallMcpContributor {
	kind: ToolCallContributorKind.MCP;
	customizationId: string;
}

export type ToolCallContributor = ToolCallClientContributor | ToolCallMcpContributor;

interface ToolCallBase {
	toolCallId: string;
	toolName: string;
	displayName: string;
	intention?: string;
	contributor?: ToolCallContributor;
	_meta?: Record<string, unknown>;
}

interface ToolCallParameterFields {
	invocationMessage: StringOrMarkdown;
	toolInput?: ToolInput;
}

export type ToolInput = string | ContentRef;

export interface ToolCallResult {
	success: boolean;
	pastTenseMessage: StringOrMarkdown;
	content?: ToolResultContent[];
	structuredContent?: Record<string, unknown>;
	error?: { message: string; code?: string };
}

export interface ToolCallStreamingState extends ToolCallBase {
	status: ToolCallStatus.Streaming;
	partialInput?: string;
	invocationMessage?: StringOrMarkdown;
}

export interface ToolCallPendingConfirmationState extends ToolCallBase, ToolCallParameterFields {
	status: ToolCallStatus.PendingConfirmation;
	confirmationTitle?: StringOrMarkdown;
	riskAssessment?: ToolCallRiskAssessment;
	edits?: { items: FileEdit[] };
	editable?: boolean;
	options?: ConfirmationOption[];
}

interface ToolCallPostConfirmationFields {
	confirmed: ToolCallConfirmationReason;
	selectedOption?: ConfirmationOption;
}

export interface ToolCallRunningState extends ToolCallBase, ToolCallParameterFields, ToolCallPostConfirmationFields {
	status: ToolCallStatus.Running;
	content?: ToolResultContent[];
}

export interface ToolCallAuthRequiredState extends ToolCallBase, ToolCallParameterFields, ToolCallPostConfirmationFields {
	status: ToolCallStatus.AuthRequired;
	contributor: ToolCallMcpContributor;
	auth: McpAuthRequirement;
	content?: ToolResultContent[];
}

export interface ToolCallPendingResultConfirmationState extends ToolCallBase, ToolCallParameterFields, ToolCallResult, ToolCallPostConfirmationFields {
	status: ToolCallStatus.PendingResultConfirmation;
}

export interface ToolCallCompletedState extends ToolCallBase, ToolCallParameterFields, ToolCallResult, ToolCallPostConfirmationFields {
	status: ToolCallStatus.Completed;
}

export interface ToolCallCancelledState extends ToolCallBase, ToolCallParameterFields {
	status: ToolCallStatus.Cancelled;
	reason: ToolCallCancellationReason;
	reasonMessage?: StringOrMarkdown;
	userSuggestion?: Message;
	selectedOption?: ConfirmationOption;
}

export type ToolCallState =
	| ToolCallStreamingState
	| ToolCallPendingConfirmationState
	| ToolCallRunningState
	| ToolCallAuthRequiredState
	| ToolCallPendingResultConfirmationState
	| ToolCallCompletedState
	| ToolCallCancelledState;

export type ToolCallConfirmationState =
	| ToolCallPendingConfirmationState
	| ToolCallPendingResultConfirmationState;



export const enum ToolResultContentType {
	Text = 'text',
	EmbeddedResource = 'embeddedResource',
	Resource = 'resource',
	FileEdit = 'fileEdit',
	Terminal = 'terminal',
	Subagent = 'subagent',
}

export interface ToolResultTextContent {
	type: ToolResultContentType.Text;
	text: string;
}

export interface ToolResultEmbeddedResourceContent {
	type: ToolResultContentType.EmbeddedResource;
	data: string;
	contentType: string;
}

export interface ToolResultResourceContent extends ContentRef {
	type: ToolResultContentType.Resource;
}

export interface ToolResultFileEditContent extends FileEdit {
	type: ToolResultContentType.FileEdit;
}

export interface ToolResultTerminalContent {
	type: ToolResultContentType.Terminal;
	resource: URI;
	title: string;
	isPty?: boolean;
	result?: TerminalCommandResult;
}

export interface TerminalCommandResult {
	exitCode?: number;
	preview?: string;
	truncated?: boolean;
}

export interface ToolResultSubagentContent {
	type: ToolResultContentType.Subagent;
	resource: URI;
	title: string;
	agentName?: string;
	description?: string;
}

export type ToolResultContent =
	| ToolResultTextContent
	| ToolResultEmbeddedResourceContent
	| ToolResultResourceContent
	| ToolResultFileEditContent
	| ToolResultTerminalContent
	| ToolResultSubagentContent;
