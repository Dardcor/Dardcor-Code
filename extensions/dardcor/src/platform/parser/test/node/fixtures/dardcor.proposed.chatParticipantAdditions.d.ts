/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {




	export enum ChatLocation {



		Panel = 1,



		Terminal = 2,



		Notebook = 3,



		Editor = 4
	}

	export interface ChatRequest {



		readonly attempt: number;




		readonly enableCommandDetection: boolean;




		readonly location: ChatLocation;
	}

	export interface ChatParticipant {
		onDidPerformAction: Event<ChatUserActionEvent>;
		supportIssueReporting?: boolean;




		supportsSlowReferences?: boolean;
	}

	export interface ChatErrorDetails {



		responseIsRedacted?: boolean;
	}




	export interface ChatCommand {
		readonly name: string;
		readonly description: string;
	}

	export class ChatResponseDetectedParticipantPart {
		participant: string;

		command?: ChatCommand;
		constructor(participant: string, command?: ChatCommand);
	}

	export interface ChatVulnerability {
		title: string;
		description: string;
		// id: string; // Later we will need to be able to link these across multiple content chunks.
	}

	export class ChatResponseMarkdownWithVulnerabilitiesPart {
		value: MarkdownString;
		vulnerabilities: ChatVulnerability[];
		constructor(value: string | MarkdownString, vulnerabilities: ChatVulnerability[]);
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
		constructor(uri: Uri, edits: TextEdit | TextEdit[]);
	}

	export class ChatResponseConfirmationPart {
		title: string;
		message: string;
		data: any;
		constructor(title: string, message: string, data: any);
	}

	export type ExtendedChatResponsePart = ChatResponsePart | ChatResponseTextEditPart | ChatResponseDetectedParticipantPart | ChatResponseConfirmationPart;

	export class ChatResponseWarningPart {
		value: MarkdownString;
		constructor(value: string | MarkdownString);
	}

	export class ChatResponseProgressPart2 extends ChatResponseProgressPart {
		value: string;
		task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>;
		constructor(value: string, task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>);
	}

	export interface ChatResponseStream {









		progress(value: string, task?: (progress: Progress<ChatResponseWarningPart | ChatResponseReferencePart>) => Thenable<string | void>): void;

		textEdit(target: Uri, edits: TextEdit | TextEdit[]): void;
		markdownWithVulnerabilities(value: string | MarkdownString, vulnerabilities: ChatVulnerability[]): void;
		detectedParticipant(participant: string, command?: ChatCommand): void;
		push(part: ChatResponsePart | ChatResponseTextEditPart | ChatResponseDetectedParticipantPart | ChatResponseWarningPart | ChatResponseProgressPart2): void;











		confirmation(title: string, message: string, data: any): void;








		warning(message: string | MarkdownString): void;

		reference(value: Uri | Location | { variableName: string; value?: Uri | Location }, iconPath?: Uri | ThemeIcon | { light: Uri; dark: Uri }): void;

		push(part: ExtendedChatResponsePart): void;
	}





	export interface ChatRequest {



		acceptedConfirmationData?: any[];




		rejectedConfirmationData?: any[];
	}


	export interface ChatUsedContext {
		documents: ChatDocumentContext[];
	}

	export interface ChatParticipant {



		participantVariableProvider?: { provider: ChatParticipantCompletionItemProvider; triggerCharacters: string[] };
	}

	export interface ChatParticipantCompletionItemProvider {
		provideCompletionItems(query: string, token: CancellationToken): ProviderResult<ChatCompletionItem[]>;
	}

	export class ChatCompletionItem {
		id: string;
		label: string | CompletionItemLabel;
		values: ChatVariableValue[];
		insertText?: string;
		fullName?: string;
		icon?: ThemeIcon;
		detail?: string;
		documentation?: string | MarkdownString;
		command?: Command;

		constructor(id: string, label: string | CompletionItemLabel, values: ChatVariableValue[]);
	}

	export type ChatExtendedRequestHandler = (request: ChatRequest, context: ChatContext, response: ChatResponseStream, token: CancellationToken) => ProviderResult<ChatResult | void>;

	export namespace chat {



		export function createChatParticipant(id: string, handler: ChatExtendedRequestHandler): ChatParticipant;

		export function createDynamicChatParticipant(id: string, dynamicProps: DynamicChatParticipantProps, handler: ChatExtendedRequestHandler): ChatParticipant;







		export const _version: 1 | number;
	}




	export interface DynamicChatParticipantProps {
		name: string;
		publisherName: string;
		description?: string;
		fullName?: string;
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
	}

	export interface ChatInsertAction {
		// eslint-disable-next-line local/vscode-dts-string-type-literals
		kind: 'insert';
		codeBlockIndex: number;
		totalCharacters: number;
		newFile?: boolean;
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
		kind: 'editor';
		accepted: boolean;
	}

	export interface ChatUserActionEvent {
		readonly result: ChatResult;
		readonly action: ChatCopyAction | ChatInsertAction | ChatTerminalAction | ChatCommandAction | ChatFollowupAction | ChatBugReportAction | ChatEditorAction;
	}

	export interface ChatPromptReference {



		readonly name: string;
	}




	export enum ChatVariableLevel {
		Short = 1,
		Medium = 2,
		Full = 3
	}

	export interface ChatVariableValue {



		level: ChatVariableLevel;




		value: string | Uri;




		description?: string;
	}

	export interface ChatVariableResolverResponseStream {







		progress(value: string): ChatVariableResolverResponseStream;










		reference(value: Uri | Location): ChatVariableResolverResponseStream;






		push(part: ChatVariableResolverResponsePart): ChatVariableResolverResponseStream;
	}

	export type ChatVariableResolverResponsePart = ChatResponseProgressPart | ChatResponseReferencePart;

	export interface ChatVariableResolver {






		resolve2?(name: string, context: ChatVariableContext, stream: ChatVariableResolverResponseStream, token: CancellationToken): ProviderResult<ChatVariableValue[]>;
	}
}
