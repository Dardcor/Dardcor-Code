/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export enum ChatSessionStatus {
		Failed = 0,

		Completed = 1,

		InProgress = 2,

		NeedsInput = 3
	}

	export namespace chat {
		export function registerChatSessionItemProvider(chatSessionType: string, provider: ChatSessionItemProvider): Disposable;

		export function createChatSessionItemController(chatSessionType: string, refreshHandler: ChatSessionItemControllerRefreshHandler): ChatSessionItemController;
	}

	export interface ChatSessionItemProvider {
		readonly onDidChangeChatSessionItems: Event<void>;

		provideChatSessionItems(token: CancellationToken): ProviderResult<ChatSessionItem[]>;

		resolveChatSessionItem?: (item: ChatSessionItem, token: CancellationToken) => ProviderResult<ChatSessionItem>;


		readonly onDidCommitChatSessionItem: Event<{ original: ChatSessionItem ; modified: ChatSessionItem }>;

	}

	export type ChatSessionItemControllerRefreshHandler = (token: CancellationToken) => Thenable<void>;

	export interface ChatSessionItemControllerNewItemHandlerContext {
		readonly request: {
			readonly prompt: string;
			readonly command?: string;
		};

		readonly inputState: ChatSessionInputState;
	}

	export type ChatSessionItemControllerNewItemHandler = (context: ChatSessionItemControllerNewItemHandlerContext, token: CancellationToken) => Thenable<ChatSessionItem>;

	export type ChatSessionControllerGetInputState = (sessionResource: Uri | undefined, context: {
		readonly previousInputState: ChatSessionInputState | undefined;
	}, token: CancellationToken) => Thenable<ChatSessionInputState> | ChatSessionInputState;

	export type ChatSessionItemControllerForkHandler = (sessionResource: Uri, request: ChatRequestTurn2 | undefined, token: CancellationToken) => Thenable<ChatSessionItem> | ChatSessionItem;

	export interface ChatSessionItemController {
		readonly id: string;

		dispose(): void;

		readonly items: ChatSessionItemCollection;

		createChatSessionItem(resource: Uri, label: string): ChatSessionItem;

		readonly refreshHandler: ChatSessionItemControllerRefreshHandler;

		readonly onDidChangeChatSessionItemState: Event<ChatSessionItem>;

		newChatSessionItemHandler?: ChatSessionItemControllerNewItemHandler;

		forkHandler?: ChatSessionItemControllerForkHandler;

		getChatSessionInputState?: ChatSessionControllerGetInputState;

		resolveChatSessionItem?: (item: ChatSessionItem, token: CancellationToken) => Thenable<void>;

		createChatSessionInputState(groups: ChatSessionProviderOptionGroup[]): ChatSessionInputState;
	}

	export interface ChatSessionItemCollection extends Iterable<readonly [id: Uri, chatSessionItem: ChatSessionItem]> {
		readonly size: number;

		replace(items: readonly ChatSessionItem[]): void;

		forEach(callback: (item: ChatSessionItem, collection: ChatSessionItemCollection) => unknown, thisArg?: any): void;

		add(item: ChatSessionItem): void;

		delete(resource: Uri): void;

		get(resource: Uri): ChatSessionItem | undefined;
	}

	export interface ChatSessionItem {
		readonly resource: Uri;

		label: string;

		iconPath?: IconPath;

		description?: string | MarkdownString;

		badge?: string | MarkdownString;

		status?: ChatSessionStatus;

		tooltip?: string | MarkdownString;

		archived?: boolean;

		readonly legacyResource?: Uri;

		timing?: {
			readonly created: number;

			readonly lastRequestStarted?: number;

			readonly lastRequestEnded?: number;

			readonly startTime?: number;

			readonly endTime?: number;
		};

		changes?: readonly ChatSessionChangedFile[];

		metadata?: { readonly [key: string]: any };
	}

	export class ChatSessionChangedFile {
		readonly uri: Uri;

		readonly originalUri: Uri | undefined;

		readonly modifiedUri: Uri | undefined;

		insertions: number;

		deletions: number;

		constructor(uri: Uri, originalUri: Uri | undefined, modifiedUri: Uri | undefined, insertions: number, deletions: number);
	}

	export interface ChatSession {
		readonly title?: string;

		readonly history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn2>;

		readonly options?: Record<string, string | ChatSessionProviderOptionItem>;

		readonly activeResponseCallback?: (stream: ChatResponseStream, token: CancellationToken) => Thenable<void>;

		readonly requestHandler: ChatRequestHandler | undefined;

		readonly forkHandler?: ChatSessionItemControllerForkHandler;
	}

	export interface ChatSessionOptionChangeEvent {
		readonly resource: Uri;
		readonly updates: ReadonlyArray<{
			readonly optionId: string;

			readonly value: string | ChatSessionProviderOptionItem;
		}>;
	}

	export interface ChatSessionContentProvider {
		readonly onDidChangeChatSessionOptions?: Event<ChatSessionOptionChangeEvent>;

		readonly onDidChangeChatSessionProviderOptions?: Event<void>;

		provideChatSessionContent(resource: Uri, token: CancellationToken, context: {
			readonly inputState: ChatSessionInputState;
		}): Thenable<ChatSession> | ChatSession;

		provideHandleOptionsChange?(resource: Uri, updates: ReadonlyArray<ChatSessionOptionUpdate>, token: CancellationToken): void;

		provideChatSessionProviderOptions?(token: CancellationToken): Thenable<ChatSessionProviderOptions>;
	}

	export interface ChatSessionOptionUpdate {
		readonly optionId: string;

		readonly value: string | undefined;
	}

	export namespace chat {
		export function registerChatSessionContentProvider(scheme: string, provider: ChatSessionContentProvider, defaultChatParticipant: ChatParticipant, capabilities?: ChatSessionCapabilities): Disposable;
	}

	export interface ChatContext {
		readonly chatSessionContext?: ChatSessionContext;
	}

	export interface ChatSessionContext {
		readonly chatSessionItem: ChatSessionItem;

		readonly isUntitled: boolean;

		readonly initialSessionOptions?: ReadonlyArray<{ optionId: string; value: string | ChatSessionProviderOptionItem }>;

		readonly inputState: ChatSessionInputState;
	}

	export interface ChatSessionCapabilities {
		supportsInterruptions?: boolean;
	}

	export interface ChatSessionProviderOptionItem {
		readonly id: string;

		readonly name: string;

		readonly description?: string;

		readonly locked?: boolean;

		readonly icon?: ThemeIcon;

		readonly default?: boolean;

		readonly slashCommand?: string;

		readonly tooltip?: string;

		readonly modelMetadata?: ChatSessionProviderOptionModelMetadata;
	}

	export interface ChatSessionProviderOptionModelMetadata {
		readonly name: string;
		readonly id: string;
		readonly vendor?: string;
		readonly version?: string;
		readonly family?: string;
		readonly tooltip?: string;
		readonly pricing?: string;
		readonly multiplierNumeric?: number;
		readonly inputCost?: number;
		readonly outputCost?: number;
		readonly cacheCost?: number;
		readonly cacheWriteCost?: number;
		readonly longContextInputCost?: number;
		readonly longContextOutputCost?: number;
		readonly longContextCacheCost?: number;
		readonly longContextCacheWriteCost?: number;
		readonly priceCategory?: string;
		readonly promo?: {
			readonly id: string;
			readonly discountPercent: number;
			readonly endsAt: string;
			readonly message: string;
		};
		readonly maxInputTokens?: number;
		readonly maxOutputTokens?: number;
		readonly capabilities?: {
			readonly vision?: boolean;
			readonly toolCalling?: boolean;
		};
	}

	export interface ChatSessionProviderOptionGroup {
		readonly id: string;

		readonly name: string;

		readonly description?: string;

		readonly selected?: ChatSessionProviderOptionItem;

		readonly items: readonly ChatSessionProviderOptionItem[];

		readonly when?: string;

		readonly icon?: ThemeIcon;

		readonly commands?: Command[];

		readonly kind?: 'permissions';
	}

	export interface ChatSessionProviderOptions {
		readonly optionGroups?: readonly ChatSessionProviderOptionGroup[];

		readonly newSessionOptions?: Record<string, string | ChatSessionProviderOptionItem>;
	}

	export interface ChatSessionInputState {
		readonly onDidDispose: Event<void>;

		readonly onDidChange: Event<void>;

		readonly sessionResource: Uri | undefined;

		groups: readonly ChatSessionProviderOptionGroup[];
	}
}
