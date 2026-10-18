/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IChatMLFetcher } from '../../../platform/chat/common/chatMLFetcher';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IDomainService } from '../../../platform/endpoint/common/domainService';
import { IChatModelInformation, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';

import { IChatWebSocketManager } from '../../../platform/networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { BYOKModelCapabilities } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

interface OpenRouterModelData {
	id: string;
	name: string;
	supported_parameters?: string[];
	architecture?: {
		input_modalities?: string[];
	};
	context_length?: number;
	top_provider: {
		context_length: number;
		max_completion_tokens?: number;
	};
}

const DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

export class OpenRouterLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'OpenRouter';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			OpenRouterLMProvider.providerId,
			OpenRouterLMProvider.providerName,
			undefined,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected override getModelsBaseUrl(): string | undefined {
		return 'https://openrouter.ai/api/v1';
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/models?supported_parameters=tools`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const openRouterModelData = modelData as OpenRouterModelData;
		const supportedParameters = openRouterModelData.supported_parameters ?? [];
		const supportsReasoningEffort = supportedParameters.includes('reasoning') || supportedParameters.includes('reasoning_effort')
			? ['low', 'medium', 'high']
			: undefined;
		const contextWindow = openRouterModelData.context_length ?? openRouterModelData.top_provider.context_length;
		const requestedMaxOutputTokens = openRouterModelData.top_provider.max_completion_tokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
		const maxOutputTokens = Math.min(requestedMaxOutputTokens, Math.floor(contextWindow / 2));
		return {
			name: openRouterModelData.name,
			toolCalling: supportedParameters.includes('tools'),
			vision: openRouterModelData.architecture?.input_modalities?.includes('image') ?? false,
			maxInputTokens: contextWindow - maxOutputTokens,
			maxOutputTokens,
			supportsReasoningEffort
		};
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<LanguageModelChatConfiguration>): Promise<OpenAIEndpoint> {
		const modelInfo = this.getModelInfo(model.id, model.url);
		const isAnthropic = isAnthropicModelId(model.id);

		if (isAnthropic) {
			modelInfo.supported_endpoints = [ModelSupportedEndpoint.Messages];
		}

		const url = isAnthropic
			? `${model.url}/messages`
			: `${model.url}/chat/completions`;

		return this._instantiationService.createInstance(OpenRouterEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}
}

function isAnthropicModelId(modelId: string): boolean {
	return modelId.startsWith('anthropic/');
}

export class OpenRouterEndpoint extends OpenAIEndpoint {
	constructor(
		modelMetadata: IChatModelInformation,
		apiKey: string,
		modelUrl: string,
		@IDomainService domainService: IDomainService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
		@IChatWebSocketManager chatWebSocketService: IChatWebSocketManager,
		@ILogService logService: ILogService,
	) {
		super(modelMetadata, apiKey, modelUrl, domainService, chatMLFetcher, tokenizerProvider, instantiationService, configurationService, expService, chatWebSocketService, logService);
	}

	protected override get useMessagesApi(): boolean {
		return !!this.modelMetadata.supported_endpoints?.includes(ModelSupportedEndpoint.Messages);
	}

	public override getExtraHeaders(): Record<string, string> {
		const headers = super.getExtraHeaders();
		if (this.useMessagesApi) {
			Object.assign(headers, this.getAnthropicBetaHeader());
		}
		return headers;
	}
}
