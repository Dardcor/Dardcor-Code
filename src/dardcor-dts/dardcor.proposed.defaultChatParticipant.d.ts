/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ChatWelcomeMessageContent {
		icon: ThemeIcon;
		title: string;
		message: MarkdownString;
	}

	export interface ChatTitleProvider {
		provideChatTitle(context: ChatContext, token: CancellationToken): ProviderResult<string>;
	}

	export interface ChatSummarizer {
		provideChatSummary(context: ChatContext, token: CancellationToken): ProviderResult<string>;
	}

	export interface ChatParticipant {
		helpTextPrefix?: string | MarkdownString;

		helpTextPostfix?: string | MarkdownString;

		additionalWelcomeMessage?: string | MarkdownString;
		titleProvider?: ChatTitleProvider;
		summarizer?: ChatSummarizer;
	}
}
