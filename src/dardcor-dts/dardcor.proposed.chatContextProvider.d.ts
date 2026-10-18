/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


declare module 'vscode' {


	export type TabSelector = { uri: DocumentSelector } | { viewType: string };

	export namespace chat {

		export function registerChatWorkspaceContextProvider(id: string, provider: ChatWorkspaceContextProvider): Disposable;

		export function registerChatAttachContextProvider(id: string, provider: ChatAttachContextProvider): Disposable;

		export function registerChatExplicitContextProvider(id: string, provider: any): Disposable;


		export function registerChatTabContextProvider(selector: TabSelector, id: string, provider: ChatTabContextProvider): Disposable;

		export function registerChatResourceContextProvider(selector: DocumentSelector, id: string, provider: any): Disposable;

	}

	export interface ChatContextItem {
		iconPath?: IconPath;
		label?: string;
		resourceUri?: Uri;
		modelDescription?: string;
		tooltip?: MarkdownString;
		value?: string;
		command?: Command;
	}
	export interface ChatWorkspaceContextProvider<T extends ChatContextItem = ChatContextItem> {

		onDidChangeWorkspaceChatContext?: Event<void>;

		provideWorkspaceChatContext(token: CancellationToken): ProviderResult<T[]>;
	}

	export interface ChatAttachContextProvider<T extends ChatContextItem = ChatContextItem> {

		provideAttachChatContext(token: CancellationToken): ProviderResult<T[]>;

		resolveAttachChatContext(context: T, token: CancellationToken): ProviderResult<ChatContextItem>;
	}

	export interface ChatTabContextProvider<T extends ChatContextItem = ChatContextItem> {

		provideChatTabContext(options: { tab: Tab }, token: CancellationToken): ProviderResult<T | undefined>;

		resolveChatTabContext(context: T, token: CancellationToken): ProviderResult<ChatContextItem>;
	}
}
