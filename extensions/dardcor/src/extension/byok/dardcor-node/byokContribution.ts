/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { LanguageModelChatInformation, LanguageModelChatProvider, lm } from 'vscode';
import { IVSCodeExtensionContext } from '../../../platform/extContext/common/extensionContext';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { RunOnceScheduler } from '../../../util/dardcor/base/common/async';
import { Disposable, DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities } from '../../byok/common/byokProvider';
import { IExtensionContribution } from '../../common/contributions';
import { AbstractLanguageModelChatProvider } from './abstractLanguageModelChatProvider';
import { AnthropicLMProvider } from './anthropicProvider';
import { AzureBYOKModelProvider } from './azureProvider';
import { BYOKStorageService, IBYOKStorageService } from './byokStorageService';
import { CustomEndpointBYOKModelProvider } from './customEndpointProvider';
import { CustomOAIBYOKModelProvider } from './customOAIProvider';
import { GeminiNativeBYOKLMProvider } from './geminiNativeProvider';
import { OllamaLMProvider } from './ollamaProvider';
import { OAIBYOKLMProvider } from './openAIProvider';
import { OpenRouterLMProvider } from './openRouterProvider';
import { XAIBYOKLMProvider } from './xAIProvider';

export class BYOKContrib extends Disposable implements IExtensionContribution {
	public readonly id: string = 'byok-contribution';
	private readonly _byokStorageService: IBYOKStorageService;
	private readonly _providers: Map<string, LanguageModelChatProvider<LanguageModelChatInformation>> = new Map();
	private readonly _providerRegistrations = this._register(new DisposableStore());
	private _providersRegistered = false;
	private _knownModelsRefreshDelayMs = 5_000;
	private _knownModelsRefreshTargets: ReadonlyArray<readonly [string, AbstractLanguageModelChatProvider]> = [];
	private readonly _knownModelsRefreshScheduler = this._register(new RunOnceScheduler(() => {
		void this._refreshKnownModelsWithRetry();
	}, 0));

	constructor(
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
		@IVSCodeExtensionContext extensionContext: IVSCodeExtensionContext,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
		this._byokStorageService = new BYOKStorageService(extensionContext);
		this._registerProviders();
		this._knownModelsRefreshScheduler.schedule();
	}

	private _buildProviders(): void {
		const instantiationService = this._instantiationService;

		const anthropic = instantiationService.createInstance(AnthropicLMProvider, undefined, this._byokStorageService);
		const gemini = instantiationService.createInstance(GeminiNativeBYOKLMProvider, undefined, this._byokStorageService);
		const xai = instantiationService.createInstance(XAIBYOKLMProvider, {}, this._byokStorageService);
		const openai = instantiationService.createInstance(OAIBYOKLMProvider, {}, this._byokStorageService);

		this._providers.set(OllamaLMProvider.providerId, instantiationService.createInstance(OllamaLMProvider, this._byokStorageService));
		this._providers.set(AnthropicLMProvider.providerId, anthropic);
		this._providers.set(GeminiNativeBYOKLMProvider.providerId, gemini);
		this._providers.set(XAIBYOKLMProvider.providerId, xai);
		this._providers.set(OAIBYOKLMProvider.providerId, openai);
		this._providers.set(OpenRouterLMProvider.providerId, instantiationService.createInstance(OpenRouterLMProvider, this._byokStorageService));
		this._providers.set(AzureBYOKModelProvider.providerId, instantiationService.createInstance(AzureBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomOAIBYOKModelProvider.providerId, instantiationService.createInstance(CustomOAIBYOKModelProvider, this._byokStorageService));
		this._providers.set(CustomEndpointBYOKModelProvider.providerId, instantiationService.createInstance(CustomEndpointBYOKModelProvider, this._byokStorageService));

		this._knownModelsRefreshTargets = [
			[AnthropicLMProvider.providerName, anthropic],
			[GeminiNativeBYOKLMProvider.providerName, gemini],
			[XAIBYOKLMProvider.providerName, xai],
			[OAIBYOKLMProvider.providerName, openai],
		];
	}

	private _registerProviders(): void {
		if (!this._providersRegistered) {
			if (this._providers.size === 0) {
				this._buildProviders();
			}
			for (const [providerId, provider] of this._providers) {
				this._providerRegistrations.add(lm.registerLanguageModelChatProvider(providerId, provider));
			}
			this._providersRegistered = true;
			this._logService.info(`BYOK: registered ${this._providers.size} provider(s): ${Array.from(this._providers.keys()).join(', ')}`);
		}
	}

	private async _refreshKnownModelsWithRetry(): Promise<void> {
		if (this._store.isDisposed) {
			return;
		}

		try {
			await this._refreshKnownModels();
			this._knownModelsRefreshDelayMs = 5_000;
		} catch (err) {
			if (this._store.isDisposed) {
				return;
			}

			const retryDelayMs = this._knownModelsRefreshDelayMs;
			this._logService.warn(`BYOK: failed to refresh the Dardcor model catalog; retrying in ${Math.round(retryDelayMs / 1000)} seconds: ${err instanceof Error ? err.message : String(err)}`);
			this._knownModelsRefreshScheduler.schedule(retryDelayMs);
			this._knownModelsRefreshDelayMs = Math.min(retryDelayMs * 2, 5 * 60 * 1000);
		}
	}

	private async _refreshKnownModels(): Promise<void> {
		const knownModels = await this._fetchKnownModelList(this._fetcherService);
		if (this._store.isDisposed) {
			return;
		}
		for (const [providerName, provider] of this._knownModelsRefreshTargets) {
			provider.updateKnownModels(knownModels[providerName]);
		}
	}

	private async _fetchKnownModelList(fetcherService: IFetcherService): Promise<Record<string, BYOKKnownModels>> {
		this._logService.info('BYOK: fetching known models list');
		const response = await fetcherService.fetch('https://main.vscode-cdn.net/extensions/dardcorChat.json', { method: 'GET', callSite: 'byok-known-models' });
		if (!response.ok) {
			throw new Error(`The Dardcor model catalog request failed with HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}.`);
		}
		const data: unknown = await response.json();
		if (!isRecord(data) || data.version !== 1 || !isRecord(data.modelInfo)) {
			throw new Error('The Dardcor model catalog has an unsupported or malformed format.');
		}
		for (const [providerName, providerModels] of Object.entries(data.modelInfo)) {
			if (!isRecord(providerModels) || !Object.values(providerModels).every(isBYOKModelCapabilities)) {
				throw new Error(`The Dardcor model catalog contains invalid entries for provider '${providerName}'.`);
			}
		}
		this._logService.info('BYOK: Dardcor model catalog fetched successfully.');
		return data.modelInfo as Record<string, BYOKKnownModels>;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBYOKModelCapabilities(value: unknown): value is BYOKModelCapabilities {
	if (!isRecord(value)) {
		return false;
	}
	return typeof value.name === 'string'
		&& typeof value.maxOutputTokens === 'number'
		&& Number.isFinite(value.maxOutputTokens)
		&& value.maxOutputTokens > 0
		&& (value.maxInputTokens === undefined || (typeof value.maxInputTokens === 'number' && Number.isFinite(value.maxInputTokens) && value.maxInputTokens >= 0))
		&& (value.contextWindow === undefined || (typeof value.contextWindow === 'number' && Number.isFinite(value.contextWindow) && value.contextWindow > 0))
		&& typeof value.toolCalling === 'boolean'
		&& typeof value.vision === 'boolean';
}
