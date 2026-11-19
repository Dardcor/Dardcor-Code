/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface ProvideLanguageModelChatResponseOptions {

		readonly requestInitiator: string;

		readonly modelConfiguration?: {
			readonly [key: string]: any;
		};

		readonly includeEncryptedThinking?: boolean;
	}

	export interface LanguageModelChatInformation {

		requiresAuthorization?: true | { label: string };

		readonly multiplierNumeric?: number;

		readonly isBYOK?: boolean;

		readonly isDefault?: boolean | { [K in ChatLocation]?: boolean };

		readonly isUserSelectable?: boolean;

		readonly statusIcon?: ThemeIcon;

		readonly configurationSchema?: LanguageModelConfigurationSchema;

		readonly targetChatSessionType?: string;

		readonly warningText?: Record<string, string>;

		readonly infoText?: Record<string, string>;

		readonly promo?: {
			readonly id: string;
			readonly discountPercent: number;
			readonly endsAt?: string;
			readonly message: string;
			readonly showBanner?: boolean;
		};
	}

	export interface LanguageModelChatCapabilities {
		readonly editTools?: string[];
	}

	export type LanguageModelResponsePart2 = LanguageModelResponsePart | LanguageModelDataPart | LanguageModelThinkingPart;

	export type LanguageModelConfigurationSchema = {
		readonly properties?: {
			readonly [key: string]: Record<string, any> & {
				readonly enumItemLabels?: string[];
				readonly group?: string;
			};
		};
	};

	export interface LanguageModelChatProvider<T extends LanguageModelChatInformation = LanguageModelChatInformation> {
		provideLanguageModelChatInformation(options: PrepareLanguageModelChatModelOptions, token: CancellationToken): ProviderResult<T[]>;
		provideLanguageModelChatResponse(model: T, messages: readonly LanguageModelChatRequestMessage[], options: ProvideLanguageModelChatResponseOptions, progress: Progress<LanguageModelResponsePart2>, token: CancellationToken): Thenable<void>;
	}

	export interface PrepareLanguageModelChatModelOptions {
		readonly configuration?: {
			readonly [key: string]: any;
		};
	}

	export interface ChatRequest {
		readonly modelConfiguration?: { readonly [key: string]: any };
	}
}
