/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChatMLFetcher } from '../../../platform/chat/common/chatMLFetcher';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IDomainService } from '../../../platform/endpoint/common/domainService';
import { EndpointEditToolName, IChatModelInformation, IChatModelRequestOptions, ModelSupportedEndpoint } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IChatWebSocketManager } from '../../../platform/networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../../platform/tokenizer/node/tokenizer';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { resolveModelInfo } from '../common/byokProvider';
import { OpenAIEndpoint } from '../node/openAIEndpoint';
import { AbstractOpenAICompatibleLMProvider, LanguageModelChatConfiguration, OpenAICompatibleLanguageModelChatInformation } from './abstractLanguageModelChatProvider';
import { byokKnownModelToAPIInfoWithEffort } from './byokModelInfo';
import { IBYOKStorageService } from './byokStorageService';

export type CustomEndpointApiType = 'chat-completions' | 'responses' | 'messages';

export function resolveCustomEndpointUrl(modelId: string, url: string, apiType?: CustomEndpointApiType): string {
	if (hasExplicitApiPath(url)) {
		return url;
	}

	if (url.endsWith('/')) {
		url = url.slice(0, -1);
	}

	const defaultApiPath = apiTypeToPath(apiType);

	const versionPattern = /\/v\d+$/;
	if (versionPattern.test(url)) {
		return `${url}${defaultApiPath}`;
	}

	return `${url}/v1${defaultApiPath}`;
}

function apiTypeToPath(apiType: CustomEndpointApiType | undefined): string {
	switch (apiType) {
		case 'responses': return '/responses';
		case 'messages': return '/messages';
		case 'chat-completions':
		default:
			return '/chat/completions';
	}
}

export function hasExplicitApiPath(url: string): boolean {
	return url.includes('/responses') || url.includes('/chat/completions') || url.includes('/messages');
}

function inferApiTypeFromUrl(url: string): CustomEndpointApiType {
	if (url.includes('/messages')) {
		return 'messages';
	}
	if (url.includes('/responses')) {
		return 'responses';
	}
	return 'chat-completions';
}

function apiTypeToSupportedEndpoints(apiType: CustomEndpointApiType): ModelSupportedEndpoint[] | undefined {
	switch (apiType) {
		case 'responses':
			return [ModelSupportedEndpoint.ChatCompletions, ModelSupportedEndpoint.Responses];
		case 'messages':
			return [ModelSupportedEndpoint.Messages];
		case 'chat-completions':
		default:
			return undefined;
	}
}

export interface CustomEndpointModelProviderConfig extends LanguageModelChatConfiguration {
	url?: string;
	apiType?: CustomEndpointApiType;
	models?: CustomEndpointModelConfig[];
}

interface _CustomEndpointModelConfig {
	name: string;
	url: string;
	apiType?: CustomEndpointApiType;
	maxInputTokens?: number;
	maxOutputTokens: number;
	contextWindow?: number;
	toolCalling: boolean;
	vision: boolean;
	thinking?: boolean;
	streaming?: boolean;
	editTools?: EndpointEditToolName[];
	requestHeaders?: Record<string, string>;
	modelOptions?: IChatModelRequestOptions;
	zeroDataRetentionEnabled?: boolean;
	supportsReasoningEffort?: string[];
	reasoningEffortFormat?: 'chat-completions' | 'responses' | 'messages';
}

export interface CustomEndpointModelConfig extends _CustomEndpointModelConfig {
	id: string;
}

export class CustomEndpointBYOKModelProvider extends AbstractOpenAICompatibleLMProvider<CustomEndpointModelProviderConfig> {

	public static readonly providerName = 'CustomEndpoint';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		_byokStorageService: IBYOKStorageService,
		@ILogService logService: ILogService,
		@IFetcherService fetcherService: IFetcherService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService,
	) {
		super(CustomEndpointBYOKModelProvider.providerId, CustomEndpointBYOKModelProvider.providerName, undefined, _byokStorageService, fetcherService, logService, instantiationService, configurationService, expService);
	}

	protected override async configureDefaultGroupWithApiKeyOnly(): Promise<string | undefined> {
		return;
	}

	protected override async getAllModels(silent: boolean, apiKey: string | undefined, configuration: CustomEndpointModelProviderConfig | undefined): Promise<OpenAICompatibleLanguageModelChatInformation<CustomEndpointModelProviderConfig>[]> {
		if (configuration?.url) {
			return super.getAllModels(silent, apiKey, configuration);
		}
		const models: OpenAICompatibleLanguageModelChatInformation<CustomEndpointModelProviderConfig>[] = [];
		if (Array.isArray(configuration?.models)) {
			for (const modelConfig of configuration.models) {
				models.push({
					...byokKnownModelToAPIInfoWithEffort(this._name, modelConfig.id, modelConfig),
					url: modelConfig.url
				});
			}
		}
		return models;
	}

	protected override async createOpenAIEndPoint(model: OpenAICompatibleLanguageModelChatInformation<CustomEndpointModelProviderConfig>): Promise<OpenAIEndpoint> {
		const modelConfiguration = model.configuration?.models?.find(m => m.id === model.id);
		const apiTypeOverride = modelConfiguration?.apiType ?? model.configuration?.apiType;
		const url = resolveCustomEndpointUrl(model.id, model.url, apiTypeOverride);
		const apiType: CustomEndpointApiType = apiTypeOverride ?? inferApiTypeFromUrl(url);
		const modelCapabilities = {
			maxInputTokens: model.maxInputTokens,
			maxOutputTokens: model.maxOutputTokens,
			contextWindow: modelConfiguration?.contextWindow,
			toolCalling: !!model.capabilities?.toolCalling || false,
			vision: !!model.capabilities?.imageInput || false,
			name: model.name,
			url,
			thinking: modelConfiguration?.thinking ?? false,
			streaming: modelConfiguration?.streaming,
			requestHeaders: modelConfiguration?.requestHeaders,
			modelOptions: modelConfiguration?.modelOptions,
			zeroDataRetentionEnabled: modelConfiguration?.zeroDataRetentionEnabled,
			supportsReasoningEffort: modelConfiguration?.supportsReasoningEffort,
			reasoningEffortFormat: modelConfiguration?.reasoningEffortFormat
		};
		const modelInfo = resolveModelInfo(model.id, this._name, undefined, modelCapabilities);
		const supportedEndpoints = apiTypeToSupportedEndpoints(apiType);
		if (supportedEndpoints) {
			modelInfo.supported_endpoints = supportedEndpoints;
		}
		return this._instantiationService.createInstance(CustomEndpointOAIEndpoint, modelInfo, model.configuration?.apiKey ?? '', url);
	}

	protected getModelsBaseUrl(configuration: CustomEndpointModelProviderConfig | undefined): string | undefined {
		return configuration?.url;
	}
}

export class CustomEndpointOAIEndpoint extends OpenAIEndpoint {
	private static readonly _overridableReservedAuthHeaders: ReadonlySet<string> = new Set([
		'api-key',
		'authorization',
	]);

	private static readonly _userAuthHeaderSuppressionSet: ReadonlySet<string> = new Set([
		'api-key',
		'authorization',
		'x-api-key',
		'x-goog-api-key',
		'apikey',
	]);

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

	protected override _isReservedHeader(lowerKey: string): boolean {
		if (CustomEndpointOAIEndpoint._overridableReservedAuthHeaders.has(lowerKey)) {
			return false;
		}
		return super._isReservedHeader(lowerKey);
	}

	public override getExtraHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			'Content-Type': 'application/json'
		};
		const userSuppliedAuth = this._hasUserAuthHeader();
		if (this.useMessagesApi) {
			if (!userSuppliedAuth) {
				headers['x-api-key'] = this._apiKey;
			}
			headers['anthropic-version'] = '2023-06-01';
			Object.assign(headers, this.getAnthropicBetaHeader());
		} else if (!userSuppliedAuth) {
			if (this._modelUrl.includes('openai.azure')) {
				headers['api-key'] = this._apiKey;
			} else {
				headers['Authorization'] = `Bearer ${this._apiKey}`;
			}
		}
		for (const [key, value] of Object.entries(this._customHeaders)) {
			headers[key] = this._interpolateApiKey(value);
		}
		return headers;
	}

	private _hasUserAuthHeader(): boolean {
		for (const key of Object.keys(this._customHeaders)) {
			if (CustomEndpointOAIEndpoint._userAuthHeaderSuppressionSet.has(key.toLowerCase())) {
				return true;
			}
		}
		return false;
	}

	private _interpolateApiKey(value: string): string {
		if (!value.includes('${apiKey}')) {
			return value;
		}
		return value.split('${apiKey}').join(this._apiKey);
	}
}
