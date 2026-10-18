/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { BYOKKnownModels, BYOKModelCapabilities } from '../common/byokProvider';
import { AbstractOpenAICompatibleLMProvider } from './abstractLanguageModelChatProvider';
import { IBYOKStorageService } from './byokStorageService';

interface XAIModelData {
	id: string;
	fingerprint: string;
	created: number;
	object: string;
	owned_by: string;
	input_modalities: string[];
	output_modalities: string[];
	prompt_text_token_price: number;
	cached_prompt_text_token_price: number;
	prompt_image_token_price: number;
	completion_text_token_price: number;
	search_price?: number;
	version: string;
	aliases: string[];
}

export class XAIBYOKLMProvider extends AbstractOpenAICompatibleLMProvider {

	public static readonly providerName = 'xAI';
	public static readonly providerId = this.providerName.toLowerCase();

	constructor(
		knownModels: BYOKKnownModels,
		byokStorageService: IBYOKStorageService,
		@IFetcherService fetcherService: IFetcherService,
		@ILogService logService: ILogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService expService: IExperimentationService
	) {
		super(
			XAIBYOKLMProvider.providerId,
			XAIBYOKLMProvider.providerName,
			knownModels,
			byokStorageService,
			fetcherService,
			logService,
			instantiationService,
			configurationService,
			expService
		);
	}

	protected getModelsBaseUrl(): string | undefined {
		return 'https://api.x.ai/v1';
	}

	protected override getModelsDiscoveryUrl(modelsBaseUrl: string): string {
		return `${modelsBaseUrl}/language-models`;
	}

	protected override resolveModelCapabilities(modelData: unknown): BYOKModelCapabilities | undefined {
		const xaiModelData = modelData as XAIModelData;
		let maxInputTokens;
		let maxOutputTokens;

		const parsedVersion = this.parseXAIModelVersion(xaiModelData.id) ?? 0;
		if (xaiModelData.id.startsWith('grok-code') || parsedVersion >= 4) {
			maxInputTokens = 120000;
			maxOutputTokens = 120000;
		} else {
			maxInputTokens = 80000;
			maxOutputTokens = 30000;
		}

		return {
			name: this.humanizeXAIModelId(xaiModelData.id),
			toolCalling: true,
			vision: xaiModelData.input_modalities.includes('image'),
			maxInputTokens,
			maxOutputTokens,
		};
	}

	private parseXAIModelVersion(modelId: string): number | undefined {
		const match = modelId.match(/^grok-(\d+)/);
		return match ? parseInt(match[1], 10) : undefined;
	}

	private humanizeXAIModelId(modelId: string): string {
		const parts = modelId.split('-').filter(p => p.length > 0);
		return parts.map(p => {
			if (/^\d+$/.test(p)) {
				return p;
			}
			return p.charAt(0).toUpperCase() + p.slice(1);
		}).join(' ');
	}
}
