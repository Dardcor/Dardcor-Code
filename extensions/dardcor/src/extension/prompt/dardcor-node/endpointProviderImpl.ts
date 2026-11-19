/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelChat, lm, type ChatRequest } from 'vscode';
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ChatEndpointFamily, ChatModelFamily, EmbeddingsEndpointFamily, IChatModelInformation, ICompletionModelInformation, IEmbeddingModelInformation, IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { AutoChatEndpoint } from '../../../platform/endpoint/node/autoChatEndpoint';
import { IAutomodeService } from '../../../platform/endpoint/node/automodeService';
import { DardcorChatEndpoint, DardcorUtilityChatEndpoint, DardcorUtilitySmallChatEndpoint } from '../../../platform/endpoint/node/dardcorChatEndpoint';
import { EmbeddingEndpoint } from '../../../platform/endpoint/node/embeddingsEndpoint';
import { IModelMetadataFetcher, ModelMetadataFetcher } from '../../../platform/endpoint/node/modelMetadataFetcher';
import { ExtensionContributedChatEndpoint } from '../../../platform/endpoint/dardcor-node/extChatEndpoint';
import { ILogService } from '../../../platform/log/common/logService';
import { IChatEndpoint, IEmbeddingsEndpoint } from '../../../platform/networking/common/networking';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';


const enum BYOKUtilityModelDefault {
	None = 'none',
	MainAgent = 'mainAgent',
	DardcorRouter = 'dardcor',
}

export class ProductionEndpointProvider extends Disposable implements IEndpointProvider {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidModelsRefresh = this._register(new Emitter<void>());
	readonly onDidModelsRefresh: Event<void> = this._onDidModelsRefresh.event;

	private _chatEndpoints: Map<string, IChatEndpoint> = new Map();
	private _embeddingEndpoints: Map<string, IEmbeddingsEndpoint> = new Map();
	private readonly _modelFetcher: IModelMetadataFetcher;

	constructor(
		@IAutomodeService private readonly _autoModeService: IAutomodeService,
		@ILogService protected readonly _logService: ILogService,
		@IConfigurationService protected readonly _configService: IConfigurationService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@ITelemetryService protected readonly _telemetryService: ITelemetryService,
	) {
		super();

		this._modelFetcher = this._instantiationService.createInstance(ModelMetadataFetcher,
			false,
		);

		this._register(this._modelFetcher.onDidModelsRefresh(() => {
			this._chatEndpoints.clear();
			this._embeddingEndpoints.clear();
			this._onDidModelsRefresh.fire();
		}));

		this._register(this._configService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(ProductionEndpointProvider.UTILITY_MODEL_CONFIG_KEY)
				|| e.affectsConfiguration(ProductionEndpointProvider.UTILITY_SMALL_MODEL_CONFIG_KEY)
				|| e.affectsConfiguration(ProductionEndpointProvider.BYOK_UTILITY_MODEL_DEFAULT_CONFIG_KEY)
			) {
				this._logService.trace(`[ProductionEndpointProvider] Utility model configuration changed; invalidating alias endpoints.`);
				this._lastOverrideTelemetryFingerprint.clear();
				this._onDidModelsRefresh.fire();
			}
		}));

	}

	private static readonly UTILITY_MODEL_CONFIG_KEY = 'chat.utilityModel';
	private static readonly UTILITY_SMALL_MODEL_CONFIG_KEY = 'chat.utilitySmallModel';
	private static readonly BYOK_UTILITY_MODEL_DEFAULT_CONFIG_KEY = 'chat.byokUtilityModelDefault';
	private _mainAgentBYOKModel: LanguageModelChat | undefined;

	private readonly _lastOverrideTelemetryFingerprint = new Map<ChatEndpointFamily, string>();

	private getOrCreateChatEndpointInstance(modelMetadata: IChatModelInformation): IChatEndpoint {
		const modelId = modelMetadata.id;
		let chatEndpoint = this._chatEndpoints.get(modelId);
		if (!chatEndpoint) {
			chatEndpoint = this._instantiationService.createInstance(DardcorChatEndpoint, modelMetadata);
			this._chatEndpoints.set(modelId, chatEndpoint);
		}
		return chatEndpoint;
	}

	async getChatEndpoint(requestOrFamilyOrModel: LanguageModelChat | ChatRequest | ChatModelFamily): Promise<IChatEndpoint> {
		this._logService.trace(`Resolving chat model`);

		if (typeof requestOrFamilyOrModel === 'string') {
			return this._resolveFamily(requestOrFamilyOrModel);
		}

		const model = 'model' in requestOrFamilyOrModel ? requestOrFamilyOrModel.model : requestOrFamilyOrModel;

		if (!model) {
			return this.getChatEndpoint('dardcor-utility');
		}

		if (model.id !== 'dardcor-utility' && model.id !== 'dardcor-utility-small') {
			const mainAgentBYOKModel = model.vendor !== 'dardcor' ? model : undefined;
			const mainAgentModelChanged = this._mainAgentBYOKModel?.vendor !== mainAgentBYOKModel?.vendor
				|| this._mainAgentBYOKModel?.id !== mainAgentBYOKModel?.id
				|| this._mainAgentBYOKModel?.version !== mainAgentBYOKModel?.version;
			this._mainAgentBYOKModel = mainAgentBYOKModel;
			if (mainAgentModelChanged) {
				this._lastOverrideTelemetryFingerprint.clear();
				this._onDidModelsRefresh.fire();
			}
		}

		if (model.vendor !== 'dardcor') {
			return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model);
		}

		if (model.id === AutoChatEndpoint.pseudoModelId) {
			try {
				const allEndpoints = await this.getAllChatEndpoints();
				return this._autoModeService.resolveAutoModeEndpoint(requestOrFamilyOrModel as ChatRequest, allEndpoints);
			} catch {
				return this.getChatEndpoint('dardcor-utility');
			}
		}

		if (model.id === 'dardcor-utility-small' || model.id === 'dardcor-utility') {
			return this.getChatEndpoint(model.id);
		}

		const modelMetadata = await this._modelFetcher.getChatModelFromApiModel(model);
		return modelMetadata ? this.getOrCreateChatEndpointInstance(modelMetadata) : this.getChatEndpoint('dardcor-utility');
	}

	private async _resolveFamily(family: string): Promise<IChatEndpoint> {
		if (family === 'dardcor-utility' || family === 'dardcor-utility-small') {
			return this._resolveUtilityFamily(family);
		}
		const modelMetadata = await this._modelFetcher.getChatModelFromRouterModel(family);
		return this.getOrCreateChatEndpointInstance(modelMetadata);
	}

	private async _resolveUtilityFamily(family: 'dardcor-utility' | 'dardcor-utility-small'): Promise<IChatEndpoint> {
		const override = await this._resolveUtilityOverride(family);
		if (override) {
			return override;
		}

		if (this._mainAgentBYOKModel) {
			switch (this._getBYOKUtilityModelDefault()) {
				case BYOKUtilityModelDefault.MainAgent:
					return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, this._mainAgentBYOKModel);
				case BYOKUtilityModelDefault.None:
					throw this._createMissingUtilityModelError(family);
				case BYOKUtilityModelDefault.DardcorRouter:
					break;
			}
		}

		switch (family) {
			case 'dardcor-utility-small':
				return DardcorUtilitySmallChatEndpoint.resolve(this._modelFetcher, this._instantiationService);
			case 'dardcor-utility':
				return DardcorUtilityChatEndpoint.resolve(this._modelFetcher, this._instantiationService);
		}
	}

	private _createMissingUtilityModelError(family: 'dardcor-utility' | 'dardcor-utility-small'): Error {
		const utilityModelSetting = family === 'dardcor-utility' ? 'chat.utilityModel' : 'chat.utilitySmallModel';
		const defaultOptions = `'mainAgent' or 'dardcor'`;
		return new Error(`No utility model is configured for '${family}' while the selected main agent model is BYOK. Configure setting '${utilityModelSetting}' or set 'chat.byokUtilityModelDefault' to ${defaultOptions}.`);
	}

	private _getBYOKUtilityModelDefault(): BYOKUtilityModelDefault {
		const value = this._configService.getNonExtensionConfig<unknown>(ProductionEndpointProvider.BYOK_UTILITY_MODEL_DEFAULT_CONFIG_KEY);
		switch (value) {
			case undefined:
				return BYOKUtilityModelDefault.DardcorRouter;
			case BYOKUtilityModelDefault.None:
			case BYOKUtilityModelDefault.MainAgent:
			case BYOKUtilityModelDefault.DardcorRouter:
				return value;
			case 'copilot':
				return BYOKUtilityModelDefault.DardcorRouter;
			default:
				this._logService.warn(`[ProductionEndpointProvider] Ignoring invalid ${ProductionEndpointProvider.BYOK_UTILITY_MODEL_DEFAULT_CONFIG_KEY} value: '${String(value)}'.`);
				return BYOKUtilityModelDefault.None;
		}
	}

	private async _resolveUtilityOverride(family: ChatEndpointFamily): Promise<IChatEndpoint | undefined> {
		let configKey: string;
		if (family === 'dardcor-utility-small') {
			configKey = ProductionEndpointProvider.UTILITY_SMALL_MODEL_CONFIG_KEY;
		} else if (family === 'dardcor-utility') {
			configKey = ProductionEndpointProvider.UTILITY_MODEL_CONFIG_KEY;
		} else {
			return undefined;
		}

		const raw = this._configService.getNonExtensionConfig<unknown>(configKey);
		if (typeof raw !== 'string' || raw.length === 0) {
			if (raw !== undefined && typeof raw !== 'string') {
				this._logService.warn(`[ProductionEndpointProvider] Ignoring non-string ${configKey} override of type '${typeof raw}'.`);
			}
			return undefined;
		}

		const slashIdx = raw.indexOf('/');
		if (slashIdx <= 0 || slashIdx >= raw.length - 1) {
			this._logService.warn(`[ProductionEndpointProvider] Ignoring malformed ${configKey} override: '${raw}' (expected '\${vendor}/\${id}').`);
			return undefined;
		}
		const vendor = raw.substring(0, slashIdx);
		const id = raw.substring(slashIdx + 1);

		if (vendor === 'dardcor') {
			let allModels: IChatModelInformation[];
			try {
				allModels = await this._modelFetcher.getAllChatModels();
			} catch (err) {
				this._logService.warn(`[ProductionEndpointProvider] Failed to fetch dardcor models for ${configKey} override '${raw}'; falling back to default. Error: ${err}`);
				return undefined;
			}
			const matches = allModels.filter(m => m.id === id);
			if (matches.length === 0) {
				this._logService.warn(`[ProductionEndpointProvider] No dardcor model matched ${configKey} override '${raw}'; falling back to default.`);
				return undefined;
			}
			if (matches.length > 1) {
				this._logService.warn(`[ProductionEndpointProvider] ${configKey} override '${raw}' matched ${matches.length} dardcor models; ignoring (override is ambiguous).`);
				return undefined;
			}
			const modelMetadata = matches[0];
			this._logService.trace(`[ProductionEndpointProvider] Applying ${configKey} override: dardcor/${modelMetadata.id}`);
			this._reportOverrideAppliedTelemetry(family);
			return this.getOrCreateChatEndpointInstance(modelMetadata);
		}

		let models: readonly LanguageModelChat[];
		try {
			models = await lm.selectChatModels({ vendor, id });
		} catch (err) {
			this._logService.warn(`[ProductionEndpointProvider] Failed to resolve ${configKey} override '${raw}'; falling back to default. Error: ${err}`);
			return undefined;
		}
		if (models.length === 0) {
			this._logService.warn(`[ProductionEndpointProvider] No model matched ${configKey} override '${raw}'; falling back to default.`);
			return undefined;
		}
		if (models.length > 1) {
			this._logService.warn(`[ProductionEndpointProvider] ${configKey} override '${raw}' matched ${models.length} models; ignoring (override is ambiguous).`);
			return undefined;
		}
		const model = models[0];

		this._logService.trace(`[ProductionEndpointProvider] Applying ${configKey} override: ${model.vendor}/${model.id}`);
		this._reportOverrideAppliedTelemetry(family);
		return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, model);
	}

	private _reportOverrideAppliedTelemetry(family: ChatEndpointFamily): void {
		if (this._lastOverrideTelemetryFingerprint.has(family)) {
			return;
		}
		this._lastOverrideTelemetryFingerprint.set(family, 'applied');

		this._telemetryService.sendMSFTTelemetryEvent(
			'chat.utilityModelOverride',
			{
				family,
			},
		);
	}

	async getEmbeddingsEndpoint(family?: EmbeddingsEndpointFamily): Promise<IEmbeddingsEndpoint> {
		this._logService.trace(`Resolving embedding model`);
		const modelMetadata = await this._modelFetcher.getEmbeddingsModel('text-embedding-3-small');
		const model = await this.getOrCreateEmbeddingEndpointInstance(modelMetadata);
		this._logService.trace(`Resolved embedding model`);
		return model;
	}

	private async getOrCreateEmbeddingEndpointInstance(modelMetadata: IEmbeddingModelInformation): Promise<IEmbeddingsEndpoint> {
		const modelId = 'text-embedding-3-small';
		let embeddingEndpoint = this._embeddingEndpoints.get(modelId);
		if (!embeddingEndpoint) {
			embeddingEndpoint = this._instantiationService.createInstance(EmbeddingEndpoint, modelMetadata);
			this._embeddingEndpoints.set(modelId, embeddingEndpoint);
		}
		return embeddingEndpoint;
	}

	async getAllCompletionModels(forceRefresh?: boolean): Promise<ICompletionModelInformation[]> {
		return this._modelFetcher.getAllCompletionModels(forceRefresh ?? false);
	}

	async getAllChatEndpoints(): Promise<IChatEndpoint[]> {
		const models: IChatModelInformation[] = await this._modelFetcher.getAllChatModels();
		return models.map(model => this.getOrCreateChatEndpointInstance(model));
	}
}
