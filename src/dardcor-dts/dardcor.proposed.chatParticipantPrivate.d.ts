/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export enum ChatLocation {
		Panel = 1,
		Terminal = 2,
		Notebook = 3,
		Editor = 4,
	}

	export class ChatRequestEditorData {

		readonly editor: TextEditor;

		document: TextDocument;
		selection: Selection;

		wholeRange: Range;

		constructor(editor: TextEditor, document: TextDocument, selection: Selection, wholeRange: Range);
	}

	export class ChatRequestNotebookData {
		readonly cell: TextDocument;

		constructor(cell: TextDocument);
	}

	export interface ChatRequest {
		readonly id: string;
		readonly attempt: number;

		readonly sessionId: string;

		readonly sessionResource: Uri;

		readonly enableCommandDetection: boolean;

		readonly isParticipantDetected: boolean;

		readonly location: ChatLocation;

		readonly location2: ChatRequestEditorData | ChatRequestNotebookData | undefined;

		readonly editedFileEvents?: ChatRequestEditedFileEvent[];

		readonly subAgentInvocationId?: string;

		readonly subAgentName?: string;

		readonly parentRequestId?: string;

		readonly permissionLevel?: string;

		readonly hasHooksEnabled: boolean;

		readonly isVoiceModeInput?: boolean;

		readonly isSystemInitiated?: boolean;
	}

	export type ChatResponseVoiceProgressStage = 'investigating' | 'planning' | 'editing' | 'validating' | 'recovering';

	export class ChatResponseVoiceProgressPart {
		readonly id: ChatResponseVoiceProgressStage;
		readonly value: string;
		constructor(id: ChatResponseVoiceProgressStage, value: string);
	}

	export interface ExtendedChatResponseParts {
		ChatResponseVoiceProgressPart: ChatResponseVoiceProgressPart;
	}

	export interface ChatResponseStream {
		voiceProgress(id: ChatResponseVoiceProgressStage, value: string): void;
	}

	export enum ChatRequestEditedFileEventKind {
		Keep = 1,
		Undo = 2,
		UserModification = 3,
	}

	export interface ChatRequestEditedFileEvent {
		readonly uri: Uri;
		readonly eventKind: ChatRequestEditedFileEventKind;
	}

	export class ChatRequestTurn2 {
		readonly id?: string;
		readonly prompt: string;

		readonly participant: string;

		readonly command?: string;

		readonly references: ChatPromptReference[];

		readonly toolReferences: readonly ChatLanguageModelToolReference[];

		readonly editedFileEvents?: ChatRequestEditedFileEvent[];

		readonly modelId?: string;

		readonly modeInstructions2?: ChatRequestModeInstructions;

		constructor(prompt: string, command: string | undefined, references: ChatPromptReference[], participant: string, toolReferences: ChatLanguageModelToolReference[], editedFileEvents: ChatRequestEditedFileEvent[] | undefined, id: string | undefined, modelId: string | undefined, modeInstructions2: ChatRequestModeInstructions | undefined);
	}

	export class ChatResponseTurn2 {
		readonly id?: string;

		readonly response: ReadonlyArray<ChatResponseMarkdownPart | ChatResponseFileTreePart | ChatResponseAnchorPart | ChatResponseCommandButtonPart | ExtendedChatResponsePart | ChatToolInvocationPart>;

		readonly result: ChatResult;

		readonly participant: string;

		readonly command?: string;

		constructor(response: ReadonlyArray<ChatResponseMarkdownPart | ChatResponseFileTreePart | ChatResponseAnchorPart | ChatResponseCommandButtonPart | ExtendedChatResponsePart>, result: ChatResult, participant: string);
	}

	export interface ChatParticipant {
		supportIssueReporting?: boolean;
	}

	export enum ChatErrorLevel {
		Info = 0,
		Warning = 1,
		Error = 2,
	}

	export interface ChatErrorDetails {
		responseIsRedacted?: boolean;

		isQuotaExceeded?: boolean;

		isRateLimited?: boolean;

		isExpectedError?: boolean;

		level?: ChatErrorLevel;

		code?: string;
	}

	export namespace chat {
		export function createDynamicChatParticipant(id: string, dynamicProps: DynamicChatParticipantProps, handler: ChatExtendedRequestHandler): ChatParticipant;
	}

	export interface DynamicChatParticipantProps {
		name: string;
		publisherName: string;
		description?: string;
		fullName?: string;
	}

	export namespace lm {
		export function registerIgnoredFileProvider(provider: LanguageModelIgnoredFileProvider): Disposable;
	}

	export interface LanguageModelIgnoredFileProvider {
		provideFileIgnored(uri: Uri, token: CancellationToken): ProviderResult<boolean>;
	}

	export type PreToolUsePermissionDecision = 'allow' | 'deny' | 'ask';

	export interface LanguageModelToolInvocationOptions<T> {
		chatRequestId?: string;
		chatSessionResource?: Uri;
		chatInteractionId?: string;
		terminalCommand?: string;
		workingDirectory?: Uri;
		subAgentInvocationId?: string;
		traceparent?: string;
		tracestate?: string;
		preToolUseResult?: {
			permissionDecision?: PreToolUsePermissionDecision;
			permissionDecisionReason?: string;
			updatedInput?: object;
		};
	}

	export interface LanguageModelToolInvocationPrepareOptions<T> {
		input: T;
		chatRequestId?: string;
		chatSessionResource?: Uri;
		chatInteractionId?: string;
		workingDirectory?: Uri;
		forceConfirmationReason?: string;
	}

	export interface PreparedToolInvocation {
		pastTenseMessage?: string | MarkdownString;
		presentation?: 'hidden' | 'hiddenAfterComplete' | undefined;
	}

	export class ExtendedLanguageModelToolResult extends LanguageModelToolResult {
		toolResultMessage?: string | MarkdownString;
		toolResultDetails?: Array<Uri | Location>;
		toolMetadata?: unknown;
		hasError?: boolean;
	}


	export interface ChatParticipantMetadata {
		participant: string;
		command?: string;
		disambiguation: { category: string; description: string; examples: string[] }[];
	}

	export interface ChatParticipantDetectionResult {
		participant: string;
		command?: string;
	}

	export interface ChatParticipantDetectionProvider {
		provideParticipantDetection(chatRequest: ChatRequest, context: ChatContext, options: { participants?: ChatParticipantMetadata[]; location: ChatLocation }, token: CancellationToken): ProviderResult<ChatParticipantDetectionResult>;
	}

	export namespace chat {
		export function registerChatParticipantDetectionProvider(participantDetectionProvider: ChatParticipantDetectionProvider): Disposable;

		export const onDidDisposeChatSession: Event<string>;
	}

	export namespace window {
		export const activeChatPanelSessionResource: Uri | undefined;

		export const onDidChangeActiveChatPanelSessionResource: Event<Uri | undefined>;
	}



	export interface ChatErrorDetails {
		confirmationButtons?: ChatErrorDetailsConfirmationButton[];
	}

	export interface ChatErrorDetailsConfirmationButton {
		data: any;
		label: string;
	}



	export interface LanguageModelProxy extends Disposable {
		readonly uri: Uri;
		readonly key: string;
	}

	export interface LanguageModelProxyProvider {
		provideModelProxy(forExtensionId: string, token: CancellationToken): ProviderResult<LanguageModelProxy>;
	}

	export namespace lm {
		export function registerLanguageModelProxyProvider(provider: LanguageModelProxyProvider): Disposable;
	}



	export interface ChatContext {
		readonly yieldRequested: boolean;

		readonly sessionResource?: Uri;
	}


	export interface LanguageModelToolInformation {
		readonly fullReferenceName?: string;
	}


	export interface ChatQuotaSnapshot {
		readonly percentRemaining: number;
		readonly unlimited: boolean;
		readonly hasQuota?: boolean;
		readonly resetAt?: number;
		readonly usageBasedBilling?: boolean;
		readonly entitlement?: number;
		readonly quotaRemaining?: number;
	}

	export interface ChatRateLimitSnapshot {
		readonly percentRemaining: number;
		readonly unlimited: boolean;
		readonly resetDate?: string;
	}

	export interface ChatQuotaSnapshots {
		readonly resetDate?: string;
		readonly resetDateHasTime?: boolean;
		readonly usageBasedBilling?: boolean;
		readonly canUpgradePlan?: boolean;
		readonly chat?: ChatQuotaSnapshot;
		readonly completions?: ChatQuotaSnapshot;
		readonly premiumChat?: ChatQuotaSnapshot;
		readonly additionalUsageEnabled?: boolean;
		readonly additionalUsageCount?: number;
		readonly sessionRateLimit?: ChatRateLimitSnapshot;
		readonly weeklyRateLimit?: ChatRateLimitSnapshot;
	}

	export namespace chat {
		export function updateQuotas(quotas: ChatQuotaSnapshots): void;
	}

}
