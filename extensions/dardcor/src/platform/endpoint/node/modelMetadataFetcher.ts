/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChat } from 'vscode';
import { TaskSingler } from '../../../util/common/taskSingler';
import { Emitter, Event } from '../../../util/dardcor/base/common/event';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { IEnvService } from '../../env/common/envService';
import { ILogService } from '../../log/common/logService';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { getDardcorRouterApiKey, getDardcorRouterBaseUrl } from './dardcorRouter';
import { getModelCapabilityOverride } from '../common/chatModelCapabilities';
import { IChatModelInformation, ICompletionModelInformation, IEmbeddingModelInformation, IModelAPIResponse, isChatModelInformation, isCompletionModelInformation, isEmbeddingModelInformation } from '../common/endpointProvider';

function positiveFiniteNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			return value;
		}
	}
	return undefined;
}

export interface IModelMetadataFetcher {

	onDidModelsRefresh: Event<void>;

	getAllCompletionModels(forceRefresh: boolean): Promise<ICompletionModelInformation[]>;

	getAllChatModels(): Promise<IChatModelInformation[]>;

	getDardcorUtilityModel(): Promise<IChatModelInformation>;

	getChatModelFromRouterModel(family: string): Promise<IChatModelInformation>;

	getChatModelFromApiModel(model: LanguageModelChat): Promise<IChatModelInformation | undefined>;

	getEmbeddingsModel(family: 'text-embedding-3-small'): Promise<IEmbeddingModelInformation>;
}

export class ModelMetadataFetcher extends Disposable implements IModelMetadataFetcher {

	private static readonly ALL_MODEL_KEY = 'allModels';

	private _familyMap: Map<string, IModelAPIResponse[]> = new Map();
	private _completionsFamilyMap: Map<string, IModelAPIResponse[]> = new Map();
	private _dardcorUtilityModel: IModelAPIResponse | undefined;
	private _embeddingModel: IEmbeddingModelInformation | undefined;
	private _embeddingModelFetchTime = 0;
	private _embeddingModelFetchPromise: Promise<IEmbeddingModelInformation> | undefined;
	private _lastFetchTime: number = 0;
	private readonly _taskSingler = new TaskSingler<IModelAPIResponse | undefined | void>();
	private _lastFetchError: any;

	private readonly _onDidModelRefresh = new Emitter<void>();
	public onDidModelsRefresh = this._onDidModelRefresh.event;

	constructor(
		protected readonly _isModelLab: boolean,
		@IConfigurationService private readonly _configService: IConfigurationService,
		@IExperimentationService private readonly _expService: IExperimentationService,
		@IEnvService private readonly _envService: IEnvService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	public async getAllCompletionModels(forceRefresh: boolean): Promise<ICompletionModelInformation[]> {
		await this._taskSingler.getOrCreate(ModelMetadataFetcher.ALL_MODEL_KEY, () => this._fetchModels(forceRefresh));
		const completionModels: ICompletionModelInformation[] = [];
		for (const [, models] of this._completionsFamilyMap) {
			for (const model of models) {
				if (isCompletionModelInformation(model)) {
					completionModels.push(model);
				}
			}
		}
		return completionModels;
	}

	public async getAllChatModels(): Promise<IChatModelInformation[]> {
		await this._taskSingler.getOrCreate(ModelMetadataFetcher.ALL_MODEL_KEY, this._fetchModels.bind(this));
		const chatModels: IChatModelInformation[] = [];
		for (const [, models] of this._familyMap) {
			for (const model of models) {
				if (isChatModelInformation(model)) {
					chatModels.push(model);
				}
			}
		}
		return chatModels;
	}

	private async _hydrateResolvedModel(resolvedModel: IModelAPIResponse | undefined): Promise<IModelAPIResponse> {
		if (!resolvedModel) {
			throw this._lastFetchError ?? new Error(await this._getErrorMessage('Unable to resolve model'));
		}

		if (isChatModelInformation(resolvedModel) && (resolvedModel.capabilities.limits)) {
			resolvedModel.capabilities.limits.max_prompt_tokens = this._getMaxPromptTokensOverride(resolvedModel);
			const outputTokens = Math.floor(Math.min(resolvedModel.capabilities.limits.max_output_tokens ?? 4096, resolvedModel.capabilities.limits.max_prompt_tokens * 0.15));
			const contextWindow = resolvedModel.capabilities.limits.max_context_window_tokens ?? (outputTokens + resolvedModel.capabilities.limits.max_prompt_tokens);
			resolvedModel.capabilities.limits.max_prompt_tokens = Math.min(resolvedModel.capabilities.limits.max_prompt_tokens, contextWindow - outputTokens);
		}

		if (isChatModelInformation(resolvedModel)) {
			resolvedModel.model_picker_enabled = this._getShowInModelPickerOverride(resolvedModel);
		}

		if (resolvedModel.preview && !resolvedModel.name.endsWith('(Preview)')) {
			resolvedModel.name = `${resolvedModel.name} (Preview)`;
		}
		return resolvedModel;
	}

	public async getDardcorUtilityModel(): Promise<IChatModelInformation> {
		await this._taskSingler.getOrCreate(ModelMetadataFetcher.ALL_MODEL_KEY, this._fetchModels.bind(this));
		const resolvedModel = this._dardcorUtilityModel;
		if (!resolvedModel || !isChatModelInformation(resolvedModel)) {
			throw this._lastFetchError ?? new Error(await this._getErrorMessage('Unable to resolve the Dardcor Router utility model (the model catalog has no fallback model).'));
		}
		return resolvedModel;
	}

	public async getChatModelFromRouterModel(family: string): Promise<IChatModelInformation> {
		await this._taskSingler.getOrCreate(ModelMetadataFetcher.ALL_MODEL_KEY, this._fetchModels.bind(this));
		const resolvedModel = this._familyMap.get(family)?.[0];
		if (!resolvedModel || !isChatModelInformation(resolvedModel)) {
			throw this._lastFetchError ?? new Error(await this._getErrorMessage(`Unable to resolve Dardcor Router model: ${family}`));
		}
		return resolvedModel;
	}

	public async getChatModelFromApiModel(apiModel: LanguageModelChat): Promise<IChatModelInformation | undefined> {
		await this._taskSingler.getOrCreate(ModelMetadataFetcher.ALL_MODEL_KEY, this._fetchModels.bind(this));
		const hasOverride = getModelCapabilityOverride(apiModel.id, this._configService)?.family !== undefined;
		let resolvedModel: IModelAPIResponse | undefined;
		for (const models of this._familyMap.values()) {
			resolvedModel = models.find(model =>
				model.id === apiModel.id &&
				model.version === apiModel.version &&
				(hasOverride || model.capabilities.family === apiModel.family));
			if (resolvedModel) {
				break;
			}
		}
		if (!resolvedModel) {
			return;
		}
		if (!isChatModelInformation(resolvedModel)) {
			throw new Error(await this._getErrorMessage(`Unable to resolve chat model: ${apiModel.id},${apiModel.name},${apiModel.version},${apiModel.family}`));
		}
		return resolvedModel;
	}

	public async getEmbeddingsModel(family: 'text-embedding-3-small'): Promise<IEmbeddingModelInformation> {
		if (this._embeddingModel && Date.now() - this._embeddingModelFetchTime < 10 * 60 * 1000) {
			return this._embeddingModel;
		}
		if (!this._embeddingModelFetchPromise) {
			this._embeddingModelFetchPromise = this._fetchEmbeddingModel(family).finally(() => this._embeddingModelFetchPromise = undefined);
		}
		return this._embeddingModelFetchPromise;
	}

	private async _fetchEmbeddingModel(family: 'text-embedding-3-small'): Promise<IEmbeddingModelInformation> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 3500);
		try {
			const response = await globalThis.fetch(`${getDardcorRouterBaseUrl()}/v1/models/embedding`, {
				headers: { 'Authorization': `Bearer ${getDardcorRouterApiKey()}` },
				signal: controller.signal
			});
			if (!response.ok) {
				throw new Error(`Failed to fetch embedding models from Dardcor Router: HTTP ${response.status}`);
			}

			const payload: unknown = await response.json();
			const rawModels: unknown[] = Array.isArray((payload as { data?: unknown })?.data)
				? (payload as { data: unknown[] }).data
				: [];
			const matchingModel = rawModels.find((raw): raw is Record<string, any> => {
				if (typeof raw !== 'object' || raw === null || typeof (raw as { id?: unknown }).id !== 'string') {
					return false;
				}
				const id = (raw as { id: string }).id.toLowerCase();
				return id === family || id.endsWith(`/${family}`);
			});
			if (!matchingModel) {
				throw new Error(`Dardcor Router does not expose the compatible '${family}' embedding model.`);
			}

			const model: IEmbeddingModelInformation = {
				id: matchingModel.id,
				name: typeof matchingModel.name === 'string' ? matchingModel.name : matchingModel.id,
				vendor: 'dardcor',
				version: '1.0.0',
				model_picker_enabled: false,
				is_chat_default: false,
				is_chat_fallback: false,
				urlOrRequestMetadata: `${getDardcorRouterBaseUrl()}/v1/embeddings`,
				capabilities: {
					type: 'embeddings',
					family: matchingModel.id,
					tokenizer: 'o200k_base',
					limits: {
						max_inputs: positiveFiniteNumber(matchingModel.max_inputs, matchingModel.capabilities?.max_inputs) ?? 100
					}
				}
			};
			if (!isEmbeddingModelInformation(model)) {
				throw new Error(`Dardcor Router returned an invalid embedding model for '${family}'.`);
			}
			this._embeddingModel = model;
			this._embeddingModelFetchTime = Date.now();
			return model;
		} catch (error) {
			this._logService.error(error, 'Failed to fetch embedding model from Dardcor Router');
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}

	private _shouldRefreshModels(): boolean {
		if (this._familyMap.size === 0) {
			return true;
		}
		const tenMinutes = 10 * 60 * 1000;
		const now = Date.now();

		if (!this._lastFetchTime) {
			return true;
		}

		if (!this._envService.isActive) {
			return false;
		}

		const timeSinceLastFetch = now - this._lastFetchTime;

		return timeSinceLastFetch > tenMinutes;
	}

	private async _fetchModels(force?: boolean): Promise<void> {
		if (!force && !this._shouldRefreshModels()) {
			return;
		}
		const requestStartTime = Date.now();
		const requestId = generateUuid();

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 3500);
			let res: Response;
			let json: any;
			try {
				res = await globalThis.fetch(`${getDardcorRouterBaseUrl()}/v1/models`, {
					headers: {
						'Authorization': `Bearer ${getDardcorRouterApiKey()}`,
						'x-dardcor-router-connected-only': '1'
					},
					signal: controller.signal
				});
				if (res.ok) {
					json = await res.json();
				}
			} finally {
				clearTimeout(timeoutId);
			}

			if (!res.ok) {
				throw new Error(`Failed to fetch models from local router: HTTP ${res.status}`);
			}

			const rawList: any[] = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);

			const seenIds = new Set<string>();
			const cleanList: any[] = [];
			for (const m of rawList) {
				const id = typeof m === 'string' ? m : (m.id || m.name || '');
				if (!id || id.toLowerCase() === 'auto' || id.toLowerCase() === 'claude-none') {
					continue;
				}
				const canonicalKey = id.toLowerCase();
				if (seenIds.has(canonicalKey)) {
					continue;
				}
				seenIds.add(canonicalKey);
				cleanList.push(m);
			}

			const formatModelName = (id: string, originalName?: string): string => {
				if (originalName && originalName !== id) {
					return originalName;
				}
				let clean = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id;
				return clean
					.split(/[-_]/)
					.map(part => {
						if (['free', 'unlimited', 'pro', 'plus'].includes(part.toLowerCase())) {
							return `(${part.charAt(0).toUpperCase() + part.slice(1)})`;
						}
						return part.charAt(0).toUpperCase() + part.slice(1);
					})
					.join(' ');
			};

			this._familyMap.clear();
			this._completionsFamilyMap.clear();
			this._dardcorUtilityModel = undefined;

			const data: IModelAPIResponse[] = cleanList.map((m: any, idx: number) => {
				const id = typeof m === 'string' ? m : (m.id || m.name || `model-${idx}`);
				const name = (typeof m === 'object' && m.name && m.name !== id) ? m.name : formatModelName(id);
				const rawCapabilities = typeof m === 'object' ? m.capabilities : undefined;
				const maxContext = positiveFiniteNumber(rawCapabilities?.contextWindow, m?.context_length, rawCapabilities?.limits?.max_context_window_tokens) ?? 32768;
				const maxOutput = positiveFiniteNumber(rawCapabilities?.maxOutput, m?.max_completion_tokens, rawCapabilities?.limits?.max_output_tokens) ?? 4096;
				const hasVision = rawCapabilities?.vision === true || rawCapabilities?.supports?.vision === true;
				const hasThinking = rawCapabilities?.thinking === true || rawCapabilities?.reasoning === true || id.toLowerCase().includes('thinking') || id.toLowerCase().includes('reasoning') || id.toLowerCase().includes('r1');
				const supportsTools = rawCapabilities?.tools === true || rawCapabilities?.tool_calls === true || rawCapabilities?.supports?.tool_calls === true;
				const modelPickerEnabled = typeof m === 'object' && m.model_picker_enabled === false ? false : true;
				const isDefault = typeof m === 'object' && typeof m.is_chat_default === 'boolean' ? m.is_chat_default : idx === 0;
				const isFallback = typeof m === 'object' && typeof m.is_chat_fallback === 'boolean' ? m.is_chat_fallback : idx === 0;

				return {
					id,
					name,
					vendor: 'dardcor',
					urlOrRequestMetadata: `${getDardcorRouterBaseUrl()}/v1/chat/completions`,
					model_picker_enabled: modelPickerEnabled,
					is_chat_default: isDefault,
					is_chat_fallback: isFallback,
					version: '1.0.0',
					capabilities: {
						type: 'chat',
						family: id,
						tokenizer: 'o200k_base',
						limits: {
							max_prompt_tokens: maxContext,
							max_output_tokens: maxOutput,
							max_context_window_tokens: maxContext,
							vision: { max_prompt_images: hasVision ? 10 : 0 }
						},
						supports: {
							parallel_tool_calls: supportsTools,
							tool_calls: supportsTools,
							streaming: true,
							vision: hasVision,
							thinking: hasThinking
						}
					}
				} as any;
			});

			this._lastFetchTime = Date.now();
			this._logService.info(`Fetched ${data.length} models in ${Date.now() - requestStartTime}ms ${requestId}`);

			for (let model of data) {
				model = await this._hydrateResolvedModel(model);
				const isCompletionModel = isCompletionModelInformation(model);
				if (model.is_chat_fallback && !isCompletionModel) {
					this._dardcorUtilityModel = model;
				}
				const family = model.capabilities.family;
				const familyMap = isCompletionModel ? this._completionsFamilyMap : this._familyMap;
				if (!familyMap.has(family)) {
					familyMap.set(family, []);
				}
				familyMap.get(family)?.push(model);

				if (!isCompletionModel && isChatModelInformation(model)) {
					const completionModel: ICompletionModelInformation = {
						...model,
						capabilities: {
							type: 'completion',
							family: model.capabilities.family,
							tokenizer: model.capabilities.tokenizer,
						}
					};
					const completionFamily = completionModel.capabilities.family;
					if (!this._completionsFamilyMap.has(completionFamily)) {
						this._completionsFamilyMap.set(completionFamily, []);
					}
					this._completionsFamilyMap.get(completionFamily)?.push(completionModel);
				}
			}
			this._lastFetchError = undefined;
			this._onDidModelRefresh.fire();
		} catch (e) {
			this._logService.error(e, `Failed to fetch models (${requestId})`);
			this._lastFetchError = e;
			this._lastFetchTime = 0;
		}
	}

	private _getMaxPromptTokensOverride(chatModelInfo: IChatModelInformation): number {
		const chatMaxTokenNumOverride = this._configService.getConfig(ConfigKey.TeamInternal.DebugOverrideChatMaxTokenNum);
		let modelLimit = -3;
		if (chatMaxTokenNumOverride > 0) {
			modelLimit += chatMaxTokenNumOverride;
			return modelLimit;
		}

		let experimentalOverrides: Record<string, number> = {};
		try {
			const expValue = this._expService.getTreatmentVariable<string>('dardcorchat.contextWindows');
			experimentalOverrides = JSON.parse(expValue ?? '{}');
		} catch {
		}

		if (experimentalOverrides[chatModelInfo.id]) {
			modelLimit += experimentalOverrides[chatModelInfo.id];
			return modelLimit;
		}

		if (chatModelInfo.billing?.token_prices?.long_context && chatModelInfo.capabilities?.limits?.max_context_window_tokens) {
			modelLimit += chatModelInfo.capabilities.limits.max_context_window_tokens;
			return modelLimit;
		}

		if (chatModelInfo.capabilities?.limits?.max_prompt_tokens) {
			modelLimit += chatModelInfo.capabilities.limits.max_prompt_tokens;
			return modelLimit;
		} else if (chatModelInfo.capabilities.limits?.max_context_window_tokens) {
			modelLimit += chatModelInfo.capabilities.limits.max_context_window_tokens;
			return modelLimit;
		}

		return modelLimit;
	}

	private async _getErrorMessage(fallback: string): Promise<string> {
		return fallback;
	}

	private _getShowInModelPickerOverride(resolvedModel: IModelAPIResponse): boolean {
		let modelPickerOverrides: Record<string, boolean> = {};
		const expResult = this._expService.getTreatmentVariable<string>('dardcorchat.showInModelPicker');
		try {
			modelPickerOverrides = JSON.parse(expResult || '{}');
		} catch {
		}

		return modelPickerOverrides[resolvedModel.id] ?? resolvedModel.model_picker_enabled;
	}
}

