/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { RequestMetadata } from '@vscode/copilot-api';
import type { LanguageModelChat } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { TokenizerType } from '../../../util/common/tokenizer';
import { Event } from '../../../util/dardcor/base/common/event';
import type { ChatRequest } from '../../../dardcorTypes';
import { IChatEndpoint, IEmbeddingsEndpoint } from '../../networking/common/networking';

export type CustomModel = {
	key_name: string;
	owner_name: string;
};

export type EndpointEditToolName = 'find-replace' | 'multi-find-replace' | 'apply-patch' | 'code-rewrite';

export interface IChatModelRequestOptions {
	temperature?: number | null;
	top_p?: number | null;
}

const allEndpointEditToolNames: ReadonlySet<EndpointEditToolName> = new Set([
	'find-replace',
	'multi-find-replace',
	'apply-patch',
	'code-rewrite'
]);

export function isEndpointEditToolName(toolName: string): toolName is EndpointEditToolName {
	return allEndpointEditToolNames.has(toolName as EndpointEditToolName);
}

export type IChatModelCapabilities = {
	type: 'chat';
	family: string;
	tokenizer: TokenizerType;
	limits?: {
		max_prompt_tokens?: number;
		max_output_tokens?: number;
		max_context_window_tokens?: number;
		vision?: {
			max_prompt_images?: number;
		};
	};
	supports: {
		parallel_tool_calls?: boolean;
		tool_calls?: boolean;
		streaming: boolean | undefined;
		vision?: boolean;
		prediction?: boolean;
		thinking?: boolean;
		adaptive_thinking?: boolean;
		max_thinking_budget?: number;
		min_thinking_budget?: number;
		reasoning_effort?: string[];
		tool_search?: boolean;
		context_editing?: boolean;
	};
};

export type IEmbeddingModelCapabilities = {
	type: 'embeddings';
	family: string;
	tokenizer: TokenizerType;
	limits?: { max_inputs?: number };
};

type ICompletionModelCapabilities = {
	type: 'completion';
	family: string;
	tokenizer: TokenizerType;
};

export enum ModelSupportedEndpoint {
	ChatCompletions = '/chat/completions',
	Responses = '/responses',
	WebSocketResponses = 'ws:/responses',
	Messages = '/v1/messages'
}

export interface IModelTokenPriceTier {
	input_price: number;
	output_price: number;
	cache_price: number;
	context_max?: number;
}

export interface IModelTokenPrices {
	batch_size: number;
	default: IModelTokenPriceTier;
	long_context?: IModelTokenPriceTier;
}

export interface IModelPromo {
	id: string;
	discount_percent: number;
	ends_at: string;
	message: string;
}

export interface IModelBilling {
	is_premium?: boolean;
	multiplier?: number;
	restricted_to?: string[];
	token_prices?: IModelTokenPrices;
	promo?: IModelPromo;
}

export interface IModelAPIResponse {
	id: string;
	vendor: string;
	name: string;
	model_picker_enabled: boolean;
	preview?: boolean;
	is_chat_default: boolean;
	is_chat_fallback: boolean;
	version: string;
	warning_messages?: { code: string; message: string }[];
	info_messages?: { code: string; message: string }[];
	warning_text?: Record<string, string>;
	billing?: IModelBilling;
	model_picker_price_category?: string;
	model_picker_category?: string;
	capabilities: IChatModelCapabilities | ICompletionModelCapabilities | IEmbeddingModelCapabilities;
	supported_endpoints?: ModelSupportedEndpoint[];
	custom_model?: CustomModel;
}

export type IChatModelInformation = IModelAPIResponse & {
	capabilities: IChatModelCapabilities;
	urlOrRequestMetadata?: string | RequestMetadata;
	requestHeaders?: Readonly<Record<string, string>>;
	modelOptions?: Readonly<IChatModelRequestOptions>;
	zeroDataRetentionEnabled?: boolean;
	reasoningEffortFormat?: 'chat-completions' | 'responses' | 'messages';
};

export function isChatModelInformation(model: IModelAPIResponse): model is IChatModelInformation {
	return model.capabilities.type === 'chat';
}

export function isEmbeddingModelInformation(model: IModelAPIResponse): model is IEmbeddingModelInformation {
	return model.capabilities.type === 'embeddings';
}

export type IEmbeddingModelInformation = IModelAPIResponse & { capabilities: IEmbeddingModelCapabilities };

export type ICompletionModelInformation = IModelAPIResponse & {
	capabilities: ICompletionModelCapabilities;
};

export function isCompletionModelInformation(model: IModelAPIResponse): model is ICompletionModelInformation {
	return model.capabilities.type === 'completion';
}

export type ChatEndpointFamily = 'dardcor-utility' | 'dardcor-utility-small';

export type ChatModelFamily = ChatEndpointFamily | (string & {});

export type EmbeddingsEndpointFamily = 'text3small' | 'metis';

export interface IEndpointProvider {
	readonly _serviceBrand: undefined;

	readonly onDidModelsRefresh: Event<void>;

	getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]>;

	getAllChatEndpoints(): Promise<IChatEndpoint[]>;

	getChatEndpoint(requestOrFamily: LanguageModelChat | ChatRequest | ChatModelFamily): Promise<IChatEndpoint>;

	getEmbeddingsEndpoint(family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint>;
}

export const IEndpointProvider = createServiceIdentifier<IEndpointProvider>('IEndpointProvider');
