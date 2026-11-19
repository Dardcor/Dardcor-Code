/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export class ChatSessionCustomizationType {
		static readonly Agent: ChatSessionCustomizationType;
		static readonly Skill: ChatSessionCustomizationType;
		static readonly Instructions: ChatSessionCustomizationType;
		static readonly Prompt: ChatSessionCustomizationType;
		static readonly Hook: ChatSessionCustomizationType;
		static readonly Plugins: ChatSessionCustomizationType;

		readonly id: string;

		constructor(id: string);
	}

	export interface ChatSessionCustomizationProviderMetadata {
		readonly label: string;

		readonly iconId?: string;

		readonly supportedTypes?: readonly ChatSessionCustomizationType[];
	}

	export type ChatSessionCustomizationSource = 'local' | 'user' | 'extension' | 'plugin' | 'builtin';

	export interface ChatSessionCustomizationItem {
		readonly uri: Uri;

		readonly type: ChatSessionCustomizationType;

		readonly name: string;

		readonly description?: string;

		readonly source: ChatSessionCustomizationSource;

		readonly extensionId?: string;

		readonly pluginUri?: Uri;

		readonly pluginLabel?: string;

		readonly groupKey?: string;

		readonly badge?: string;

		readonly badgeTooltip?: string;

		readonly userInvocable?: boolean;
	}

	export interface ChatSessionCustomizationProvider {
		readonly onDidChange?: Event<void>;

		provideChatSessionCustomizations(sessionResource: Uri, token: CancellationToken): ProviderResult<ChatSessionCustomizationItem[]>;

		provideSourceFolders?(sessionResource: Uri, type: ChatSessionCustomizationType, token: CancellationToken): ProviderResult<ChatSessionCustomizationSourceFolder[]>;
	}

	export interface ChatSessionCustomizationSourceFolder {
		readonly uri: Uri;
		readonly label: string;
		readonly source: ChatSessionCustomizationSource;
		readonly destinationGroupId?: string;
	}



	export namespace chat {
		export function registerChatSessionCustomizationProvider(chatSessionType: string, metadata: ChatSessionCustomizationProviderMetadata, provider: ChatSessionCustomizationProvider): Disposable;
	}

}
