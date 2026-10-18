/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { Disposable, LanguageModelChatInformation, LanguageModelDataPart, LanguageModelTextPart, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart } from 'vscode';
import { EndpointEditToolName, IChatModelInformation, IChatModelRequestOptions, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { TokenizerType } from '../../../util/common/tokenizer';

export const enum BYOKAuthType {
	GlobalApiKey,
	PerModelDeployment,
	None
}

interface BYOKBaseModelConfig {
	modelId: string;
	capabilities?: BYOKModelCapabilities;
}

export type LMResponsePart = LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart | LanguageModelThinkingPart | LanguageModelToolResultPart;

export interface BYOKGlobalKeyModelConfig extends BYOKBaseModelConfig {
	apiKey: string;
}

export interface BYOKPerModelConfig extends BYOKBaseModelConfig {
	apiKey: string;
	deploymentUrl: string;
}

interface BYOKNoAuthModelConfig extends BYOKBaseModelConfig {
}

export type BYOKModelConfig = BYOKGlobalKeyModelConfig | BYOKPerModelConfig | BYOKNoAuthModelConfig;

export interface BYOKModelCapabilities {
	name: string;
	url?: string;
	maxInputTokens?: number;
	maxOutputTokens: number;
	contextWindow?: number;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	adaptiveThinking?: boolean;
	streaming?: boolean;
	editTools?: EndpointEditToolName[];
	requestHeaders?: Record<string, string>;
	modelOptions?: IChatModelRequestOptions;
	supportedEndpoints?: ModelSupportedEndpoint[];
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: 'chat-completions' | 'responses' | 'messages';
}

export interface BYOKModelRegistry {
	readonly name: string;
	readonly authType: BYOKAuthType;
	updateKnownModelsList(knownModels: BYOKKnownModels | undefined): void;
	getAllModels(apiKey?: string): Promise<{ id: string; name: string }[]>;
	registerModel(config: BYOKModelConfig): Promise<Disposable>;
}

export type BYOKKnownModels = Record<string, BYOKModelCapabilities>;

export function isGlobalKeyConfig(config: BYOKModelConfig): config is BYOKGlobalKeyModelConfig {
	return 'apiKey' in config && !('deploymentUrl' in config);
}

export function isPerModelConfig(config: BYOKModelConfig): config is BYOKPerModelConfig {
	return 'apiKey' in config && 'deploymentUrl' in config;
}

export function isNoAuthConfig(config: BYOKModelConfig): config is BYOKNoAuthModelConfig {
	return !('apiKey' in config) && !('deploymentUrl' in config);
}

export function resolveModelTokenLimits(capabilities: Pick<BYOKModelCapabilities, 'maxInputTokens' | 'maxOutputTokens' | 'contextWindow'>): { contextWindow: number; maxInputTokens: number; maxOutputTokens: number } {
	const contextWindow = capabilities.contextWindow ?? ((capabilities.maxInputTokens ?? 0) + capabilities.maxOutputTokens);
	const maxOutputTokens = Math.min(capabilities.maxOutputTokens, contextWindow);
	const remainingInputBudget = Math.max(0, contextWindow - maxOutputTokens);
	const maxInputTokens = Math.min(capabilities.maxInputTokens ?? remainingInputBudget, remainingInputBudget);
	return { contextWindow, maxInputTokens, maxOutputTokens };
}

export function resolveModelInfo(modelId: string, providerName: string, knownModels: BYOKKnownModels | undefined, modelCapabilities?: BYOKModelCapabilities): IChatModelInformation {
	let knownModelInfo = modelCapabilities;
	if (knownModels && !knownModelInfo) {
		knownModelInfo = knownModels[modelId];
	}
	const modelName = knownModelInfo?.name || modelId;
	const limits = knownModelInfo
		? resolveModelTokenLimits(knownModelInfo)
		: { contextWindow: 128000, maxInputTokens: 100000, maxOutputTokens: 8192 };
	const modelInfo: IChatModelInformation = {
		id: modelId,
		name: modelName,
		vendor: providerName,
		version: '1.0.0',
		capabilities: {
			type: 'chat',
			family: modelId,
			supports: {
				streaming: knownModelInfo?.streaming ?? true,
				tool_calls: !!knownModelInfo?.toolCalling,
				vision: !!knownModelInfo?.vision,
				thinking: !!knownModelInfo?.thinking,
				adaptive_thinking: !!knownModelInfo?.adaptiveThinking,
				reasoning_effort: knownModelInfo?.supportsReasoningEffort
			},
			tokenizer: TokenizerType.O200K,
			limits: {
				max_context_window_tokens: limits.contextWindow,
				max_prompt_tokens: limits.maxInputTokens,
				max_output_tokens: limits.maxOutputTokens
			}
		},
		is_chat_default: false,
		is_chat_fallback: false,
		model_picker_enabled: true,
		supported_endpoints: knownModelInfo?.supportedEndpoints,
		zeroDataRetentionEnabled: knownModelInfo?.zeroDataRetentionEnabled,
		modelOptions: knownModelInfo?.modelOptions,
		reasoningEffortFormat: knownModelInfo?.reasoningEffortFormat
	};
	if (knownModelInfo?.requestHeaders && Object.keys(knownModelInfo.requestHeaders).length > 0) {
		modelInfo.requestHeaders = { ...knownModelInfo.requestHeaders };
	}
	return modelInfo;
}

export function byokKnownModelsToAPIInfo(providerName: string, knownModels: BYOKKnownModels | undefined): LanguageModelChatInformation[] {
	if (!knownModels) {
		return [];
	}
	return Object.entries(knownModels).map(([id, capabilities]) => byokKnownModelToAPIInfo(providerName, id, capabilities));
}

export function byokKnownModelToAPIInfo(providerName: string, id: string, capabilities: BYOKModelCapabilities): LanguageModelChatInformation {
	const limits = resolveModelTokenLimits(capabilities);
	return {
		id,
		name: capabilities.name,
		version: '1.0.0',
		maxOutputTokens: limits.maxOutputTokens,
		maxInputTokens: limits.maxInputTokens,
		family: id,
		tooltip: `${capabilities.name} is contributed via the ${providerName} provider.`,
		multiplierNumeric: undefined,
		isUserSelectable: true,
		capabilities: {
			toolCalling: capabilities.toolCalling,
			imageInput: capabilities.vision,
			editTools: capabilities.editTools,
		},
	};
}

export interface HandleAPIKeyUpdateResult {
	apiKey: string | undefined;
	deleted: boolean;
	cancelled: boolean;
}

export interface IBYOKStorageServiceLike {
	getAPIKey(providerName: string, modelId?: string): Promise<string | undefined>;
	storeAPIKey(providerName: string, apiKey: string, authType: BYOKAuthType, modelId?: string): Promise<void>;
	deleteAPIKey(providerName: string, authType: BYOKAuthType, modelId?: string): Promise<void>;
}

export async function handleAPIKeyUpdate(
	providerName: string,
	storageService: IBYOKStorageServiceLike,
	promptForAPIKeyFn: (providerName: string, reconfigure: boolean) => Promise<string | undefined>
): Promise<HandleAPIKeyUpdateResult> {
	const existingKey = await storageService.getAPIKey(providerName);
	const isReconfiguring = existingKey !== undefined;

	const newAPIKey = await promptForAPIKeyFn(providerName, isReconfiguring);

	if (newAPIKey === undefined) {
		return { apiKey: undefined, deleted: false, cancelled: true };
	} else if (newAPIKey === '') {
		await storageService.deleteAPIKey(providerName, BYOKAuthType.GlobalApiKey);
		return { apiKey: undefined, deleted: true, cancelled: false };
	} else {
		await storageService.storeAPIKey(providerName, newAPIKey, BYOKAuthType.GlobalApiKey);
		return { apiKey: newAPIKey, deleted: false, cancelled: false };
	}
}
