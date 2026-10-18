/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatParticipant {
		readonly onDidPerformAction: Event<ChatUserActionEvent>;
	}

	export interface ChatCommand {
		readonly name: string;
		readonly description: string;
	}

	export interface ChatVulnerability {
		title: string;
		description: string;
	}

	export class ChatResponseMarkdownWithVulnerabilitiesPart {
		value: MarkdownString;
		vulnerabilities: ChatVulnerability[];
		constructor(value: string | MarkdownString, vulnerabilities: ChatVulnerability[]);
	}

	export class ChatResponseCodeblockUriPart {
		isEdit?: boolean;
		value: Uri;
		undoStopId?: string;
		constructor(value: Uri, isEdit?: boolean, undoStopId?: string);
	}

	export interface ChatCommandButton {
		command: Command;
	}

	export interface ChatDocumentContext {
		uri: Uri;
		version: number;
		ranges: Range[];
	}

	export class ChatResponseTextEditPart {
		uri: Uri;
		edits: TextEdit[];
		isDone?: boolean;
		constructor(uri: Uri, done: true);
		constructor(uri: Uri, edits: TextEdit | TextEdit[]);
	}

	export class ChatResponseNotebookEditPart {
		uri: Uri;
		edits: NotebookEdit[];
		isDone?: boolean;
		constructor(uri: Uri, done: true);
		constructor(uri: Uri, edits: NotebookEdit | NotebookEdit[]);
	}

	export interface ChatWorkspaceFileEdit {
		oldResource?: Uri;

		newResource?: Uri;
	}

	export class ChatResponseWorkspaceEditPart {
		edits: ChatWorkspaceFileEdit[];
		constructor(edits: ChatWorkspaceFileEdit[]);
	}

	export class ChatResponseConfirmationPart {
		title: string;
		message: string | MarkdownString;
		data: any;
		buttons?: string[];
		constructor(title: string, message: string | MarkdownString, data: any, buttons?: string[]);
	}

	export interface ChatQuestionOption {
		id: string;
		label: string;
		value: unknown;
	}

	export enum ChatQuestionType {
		Text = 1,
		SingleSelect = 2,
		MultiSelect = 3
	}

	export class ChatQuestion {
		id: string;
		type: ChatQuestionType;
		title: string;
		message?: string | MarkdownString;
		options?: ChatQuestionOption[];
		defaultValue?: string | string[];
		allowFreeformInput?: boolean;

		constructor(
			id: string,
			type: ChatQuestionType,
			title: string,
			options?: {
				message?: string | MarkdownString;
				options?: ChatQuestionOption[];
				defaultValue?: string | string[];
				allowFreeformInput?: boolean;
			}
		);
	}

	export class ChatResponseQuestionCarouselPart {
		questions: ChatQuestion[];
		allowSkip: boolean;

		constructor(questions: ChatQuestion[], allowSkip?: boolean);
	}

	export class ChatResponseCodeCitationPart {
		value: Uri;
		license: string;
		snippet: string;
		constructor(value: Uri, license: string, snippet: string);
	}

	export interface ChatToolInvocationStreamData {
		readonly partialInput?: unknown;
	}

	export interface ChatTerminalToolInvocationData {
		commandLine: {
			original: string;
			userEdited?: string;
			toolEdited?: string;
		};
		language: string;

		presentationOverrides?: {
			commandLine: string;
			language?: string;
		};

		output?: {
			text: string;
		};

		state?: {
			exitCode?: number;
			duration?: number;
		};
	}

	export class McpToolInvocationContentData {
		mimeType: string;

		data: Uint8Array;

		constructor(data: Uint8Array, mimeType: string);
	}

	export interface ChatMcpToolInvocationData {
		input: string;
		output: McpToolInvocationContentData[];
	}

	export enum ChatTodoStatus {
		NotStarted = 1,
		InProgress = 2,
		Completed = 3
	}

	export interface ChatTodoToolInvocationData {
		todoList: Array<{
			id: number;
			title: string;
			status: ChatTodoStatus;
		}>;
	}

	export interface ChatSimpleToolResultData {
		input: string;
		output: string;
	}


	export interface ChatToolResourcesInvocationData {
		values: Array<Uri | Location>;
	}

	export class ChatSubagentToolInvocationData {
		description?: string;

		agentName?: string;

		prompt?: string;

		result?: string;

		modelName?: string;

		constructor(description?: string, agentName?: string, prompt?: string, result?: string);
	}

	export class ChatToolInvocationPart {
		toolName: string;
		toolCallId: string;
		isError?: boolean;
		invocationMessage?: string | MarkdownString;
		originMessage?: string | MarkdownString;
		pastTenseMessage?: string | MarkdownString;
		isConfirmed?: boolean;
		isComplete?: boolean;
		toolSpecificData?: ChatTerminalToolInvocationData | ChatMcpToolInvocationData | ChatTodoToolInvocationData | ChatSimpleToolResultData | ChatToolResourcesInvocationData | ChatSubagentToolInvocationData;
		subAgentInvocationId?: string;
		presentation?: 'hidden' | 'hiddenAfterComplete' | undefined;

		enablePartialUpdate?: boolean;

		constructor(toolName: string, toolCallId: string, errorMessage?: string);
	}

	export interface ChatResponseDiffEntry {
		originalUri?: Uri;

		modifiedUri?: Uri;

		goToFileUri?: Uri;

		added?: number;

		removed?: number;
	}

	export class ChatResponseMultiDiffPart {
		value: ChatResponseDiffEntry[];

		title: string;

		readOnly?: boolean;

		constructor(value: ChatResponseDiffEntry[], title: string, readOnly?: boolean);
	}

	export class ChatResponseExternalEditPart {
		uris: Uri[];
		callback: () => Thenable<unknown>;
		applied: Thenable<string>;
		constructor(uris: Uri[], callback: () => Thenable<unknown>);
	}

	export interface ExtendedChatResponseParts {
		ChatResponsePart: ChatResponsePart;
		ChatResponseTextEditPart: ChatResponseTextEditPart;
		ChatResponseNotebookEditPart: ChatResponseNotebookEditPart;
		ChatResponseWorkspaceEditPart: ChatResponseWorkspaceEditPart;
		ChatResponseConfirmationPart: ChatResponseConfirmationPart;
		ChatResponseCodeCitationPart: ChatResponseCodeCitationPart;
		ChatResponseReferencePart2: ChatResponseReferencePart2;
		ChatResponseMovePart: ChatResponseMovePart;
		ChatResponseExtensionsPart: ChatResponseExtensionsPart;
		ChatResponsePullRequestPart: ChatResponsePullRequestPart;
		ChatToolInvocationPart: ChatToolInvocationPart;
		ChatResponseMultiDiffPart: ChatResponseMultiDiffPart;
		ChatResponseThinkingProgressPart: ChatResponseThinkingProgressPart;
		ChatResponseExternalEditPart: ChatResponseExternalEditPart;
		ChatResponseQuestionCarouselPart: ChatResponseQuestionCarouselPart;
		ChatResponseAutoModeResolutionPart: ChatResponseAutoModeResolutionPart;
	}

	export type ExtendedChatResponsePart = ExtendedChatResponseParts[keyof ExtendedChatResponseParts];

	export class ChatResponseWarningPart {
		value: MarkdownString;
		constructor(value: string | MarkdownString);
	}

	export class ChatResponseInfoPart {
		value: MarkdownString;
		constructor(value: string | MarkdownString);
	}

	export class ChatResponseProgressPart2 extends ChatResponseProgressPart {
		value: string;
		task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>;
		constructor(value: string, task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>);
	}

	export class ChatResponseThinkingProgressPart {
		value: string | string[];
		id?: string;
		metadata?: { readonly [key: string]: any };
		task?: (progress: Progress<LanguageModelThinkingPart>) => Thenable<string | void>;

		constructor(value: string | string[], id?: string, metadata?: { readonly [key: string]: any }, task?: (progress: Progress<LanguageModelThinkingPart>) => Thenable<string | void>);
	}

	export class ChatResponseReferencePart2 {
		value: Uri | Location | { variableName: string; value?: Uri | Location } | string;

		iconPath?: Uri | ThemeIcon | {
			light: Uri;
			dark: Uri;
		};
		options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } };

		constructor(value: Uri | Location | { variableName: string; value?: Uri | Location } | string, iconPath?: Uri | ThemeIcon | {
			light: Uri;
			dark: Uri;
		}, options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } });
	}

	export class ChatResponseMovePart {

		readonly uri: Uri;
		readonly range: Range;

		constructor(uri: Uri, range: Range);
	}

	export interface ChatResponseAnchorPart {
		value2: Uri | Location | SymbolInformation;

		resolve?(token: CancellationToken): Thenable<void>;
	}

	export class ChatResponseExtensionsPart {

		readonly extensions: string[];

		constructor(extensions: string[]);
	}

	export class ChatResponsePullRequestPart {
		readonly uri?: Uri;
		readonly command: Command;
		readonly linkTag: string;
		readonly title: string;
		readonly description: string;
		readonly author: string;
		constructor(uriOrCommand: Uri | Command, title: string, description: string, author: string, linkTag: string);
	}

	export class ChatResponseAutoModeResolutionPart {
		resolvedModel: { id: string; name: string } | undefined;
		constructor(resolvedModel?: { id: string; name: string });
	}

	export interface ChatResponseStream {

		progress(value: string, task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>): void;

		thinkingProgress(thinkingDelta: ThinkingDelta): void;

		textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;

		textEdit(target: Uri, isDone: true): void;

		notebookEdit(target: Uri, edits: NotebookEdit | NotebookEdit[]): void;

		notebookEdit(target: Uri, isDone: true): void;

		workspaceEdit(edits: ChatWorkspaceFileEdit[]): void;

		externalEdit(target: Uri | Uri[], callback: () => Thenable<unknown>): Thenable<string>;

		markdownWithVulnerabilities(value: string | MarkdownString, vulnerabilities: ChatVulnerability[]): void;
		codeblockUri(uri: Uri, isEdit?: boolean): void;
		push(part: ChatResponsePart | ChatResponseTextEditPart | ChatResponseWarningPart | ChatResponseProgressPart2): void;

		confirmation(title: string, message: string | MarkdownString, data: any, buttons?: string[]): void;

		questionCarousel(questions: ChatQuestion[], allowSkip?: boolean): Thenable<Record<string, unknown> | undefined>;

		warning(message: string | MarkdownString): void;

		info(message: string | MarkdownString): void;

		reference(value: Uri | Location | { variableName: string; value?: Uri | Location }, iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri }): void;

		reference2(value: Uri | Location | string | { variableName: string; value?: Uri | Location }, iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri }, options?: { status?: { description: string; kind: ChatResponseReferencePartStatusKind } }): void;

		codeCitation(value: Uri, license: string, snippet: string): void;

		beginToolInvocation(toolCallId: string, toolName: string, streamData?: ChatToolInvocationStreamData & { subagentInvocationId?: string }): void;

		updateToolInvocation(toolCallId: string, streamData: ChatToolInvocationStreamData): void;

		push(part: ExtendedChatResponsePart): void;

		clearToPreviousToolInvocation(reason: ChatResponseClearToPreviousToolInvocationReason): void;

		usage(usage: ChatResultUsage): void;
	}

	export enum ChatResponseReferencePartStatusKind {
		Complete = 1,
		Partial = 2,
		Omitted = 3
	}

	export type ThinkingDelta = {
		text?: string | string[];
		id: string;
		metadata?: { readonly [key: string]: any };
	} | {
		text?: string | string[];
		id?: string;
		metadata: { readonly [key: string]: any };
	} |
	{
		text: string | string[];
		id?: string;
		metadata?: { readonly [key: string]: any };
	};

	export enum ChatResponseClearToPreviousToolInvocationReason {
		NoReason = 0,
		FilteredContentRetry = 1,
		CopyrightContentRetry = 2,
	}

	export interface ChatRequest {
		acceptedConfirmationData?: any[];

		rejectedConfirmationData?: any[];
	}

	export interface ChatRequest {

		readonly tools: Map<LanguageModelToolInformation, boolean>;
	}

	export namespace lm {
		export const onDidChangeChatRequestTools: Event<ChatRequest>;
	}

	export class LanguageModelToolExtensionSource {
		readonly id: string;

		readonly label: string;

		private constructor(id: string, label: string);
	}

	export class LanguageModelToolMCPSource {
		readonly label: string;

		readonly name: string;

		readonly instructions?: string;

		private constructor(label: string, name: string, instructions?: string);
	}

	export interface LanguageModelToolInformation {
		source: LanguageModelToolExtensionSource | LanguageModelToolMCPSource | undefined;
	}

	export interface ChatUsedContext {
		documents: ChatDocumentContext[];
	}

	export interface ChatParticipant {
		participantVariableProvider?: { provider: ChatParticipantCompletionItemProvider; triggerCharacters: string[] };

		readonly onDidChangePauseState: Event<ChatParticipantPauseStateEvent>;
	}

	export interface ChatParticipantPauseStateEvent {
		request: ChatRequest;
		isPaused: boolean;
	}

	export interface ChatParticipantCompletionItemProvider {
		provideCompletionItems(query: string, token: CancellationToken): ProviderResult<ChatCompletionItem[]>;
	}

	export class ChatCompletionItem {
		id: string;
		label: string | CompletionItemLabel;
		values: ChatVariableValue[];
		fullName?: string;
		icon?: ThemeIcon;
		insertText?: string;
		detail?: string;
		documentation?: string | MarkdownString;
		command?: Command;

		constructor(id: string, label: string | CompletionItemLabel, values: ChatVariableValue[]);
	}

	export type ChatExtendedRequestHandler = (request: ChatRequest, context: ChatContext, response: ChatResponseStream, token: CancellationToken) => ProviderResult<ChatResult | void>;

	export interface ChatResultPromptTokenDetail {
		readonly category: string;

		readonly label: string;

		readonly percentageOfPrompt: number;
	}

	export interface ChatResultUsage {
		readonly promptTokens: number;

		readonly completionTokens: number;

		readonly outputBuffer?: number;

		readonly copilotCredits?: number;

		readonly dardcorCredits?: number;

		readonly promptTokenDetails?: readonly ChatResultPromptTokenDetail[];
	}

	export interface ChatResult {
		nextQuestion?: {
			prompt: string;
			participant?: string;
			command?: string;
		};
		details?: string;
	}

	export namespace chat {
		export function createChatParticipant(id: string, handler: ChatExtendedRequestHandler): ChatParticipant;
	}


	export enum ChatCopyKind {
		Action = 1,
		Toolbar = 2
	}

	export interface ChatCopyAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
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

	export interface ChatInsertAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'insert';
		codeBlockIndex: number;
		totalCharacters: number;
		totalLines: number;
		languageId?: string;
		modelId: string;
		newFile?: boolean;
	}

	export interface ChatApplyAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'apply';
		codeBlockIndex: number;
		totalCharacters: number;
		totalLines: number;
		languageId?: string;
		modelId: string;
		newFile?: boolean;
		codeMapper?: string;
	}

	export interface ChatTerminalAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'runInTerminal';
		codeBlockIndex: number;
		languageId?: string;
	}

	export interface ChatCommandAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'command';
		commandButton: ChatCommandButton;
	}

	export interface ChatFollowupAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'followUp';
		followup: ChatFollowup;
	}

	export interface ChatBugReportAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'bug';
	}

	export interface ChatEditorAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'editor';
		accepted: boolean;
	}

	export interface ChatEditingSessionAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'chatEditingSessionAction';
		uri: Uri;
		hasRemainingEdits: boolean;
		outcome: ChatEditingSessionActionOutcome;
	}

	export interface ChatEditingHunkAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'chatEditingHunkAction';
		uri: Uri;
		lineCount: number;
		linesAdded: number;
		linesRemoved: number;
		outcome: ChatEditingSessionActionOutcome;
		hasRemainingEdits: boolean;
	}

	export enum ChatEditingSessionActionOutcome {
		Accepted = 1,
		Rejected = 2,
		Saved = 3
	}

	export interface ChatUserActionEvent {
		readonly result: ChatResult;
		readonly action: ChatCopyAction | ChatInsertAction | ChatApplyAction | ChatTerminalAction | ChatCommandAction | ChatFollowupAction | ChatBugReportAction | ChatEditorAction | ChatEditingSessionAction | ChatEditingHunkAction;
	}

	export interface ChatPromptReference {
		readonly name: string;

		readonly toolReferences?: readonly ChatLanguageModelToolReference[];
	}

	export namespace lm {
		export function fileIsIgnored(uri: Uri, token?: CancellationToken): Thenable<boolean>;
	}

	export interface ChatVariableValue {
		level: ChatVariableLevel;

		value: string | Uri;

		description?: string;
	}

	export enum ChatVariableLevel {
		Short = 1,
		Medium = 2,
		Full = 3
	}

	export interface LanguageModelToolInvocationOptions<T> {
		model?: LanguageModelChat;
		chatStreamToolCallId?: string;
	}

	export interface LanguageModelToolInvocationStreamOptions<T> {
		readonly rawInput?: unknown;

		readonly chatRequestId?: string;
		readonly chatSessionResource?: Uri;
		readonly chatInteractionId?: string;
	}

	export interface LanguageModelToolStreamResult {
		invocationMessage?: string | MarkdownString;
	}

	export interface LanguageModelTool<T> {
		handleToolStream?(options: LanguageModelToolInvocationStreamOptions<T>, token: CancellationToken): ProviderResult<LanguageModelToolStreamResult>;
	}

	export interface ChatRequest {
		readonly modeInstructions?: string;
		readonly modeInstructions2?: ChatRequestModeInstructions;
	}

	export interface ChatRequestModeInstructions {
		readonly uri?: Uri;
		readonly name: string;
		readonly content: string;
		readonly toolReferences?: readonly ChatLanguageModelToolReference[];
		readonly allowedSubagents?: readonly string[];
		readonly metadata?: Record<string, boolean | string | number>;
		readonly isBuiltin?: boolean;
	}
}
