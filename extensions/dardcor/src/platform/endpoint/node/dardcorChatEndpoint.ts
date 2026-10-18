/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { IChatMLFetcher } from '../../chat/common/chatMLFetcher';
import { CHAT_MODEL, IConfigurationService } from '../../configuration/common/configurationService';
import { ILogService } from '../../log/common/logService';
import { IChatEndpoint } from '../../networking/common/networking';
import { RawMessageConversionCallback } from '../../networking/common/openai';
import { IChatWebSocketManager } from '../../networking/node/chatWebSocketManager';
import { IExperimentationService } from '../../telemetry/common/nullExperimentationService';
import { ITokenizerProvider } from '../../tokenizer/node/tokenizer';
import { IDomainService } from '../common/domainService';
import { IChatModelInformation } from '../common/endpointProvider';
import { ChatEndpoint } from './chatEndpoint';
import { getDardcorRouterApiKey, getDardcorRouterBaseUrl } from './dardcorRouter';
import { IModelMetadataFetcher } from './modelMetadataFetcher';

export class DardcorChatEndpoint extends ChatEndpoint {
	constructor(
		modelMetadata: IChatModelInformation,
		@IDomainService domainService: IDomainService,
		@IChatMLFetcher chatMLFetcher: IChatMLFetcher,
		@ITokenizerProvider tokenizerProvider: ITokenizerProvider,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentService: IExperimentationService,
		@IChatWebSocketManager chatWebSocketService: IChatWebSocketManager,
		@ILogService logService: ILogService
	) {
		super(
			modelMetadata,
			domainService,
			chatMLFetcher,
			tokenizerProvider,
			instantiationService,
			configurationService,
			experimentService,
			chatWebSocketService,
			logService
		);
	}

	public override get urlOrRequestMetadata(): string {
		return `${getDardcorRouterBaseUrl()}/v1/chat/completions`;
	}

	public override readonly ownsAuthorization = true;

	public override getExtraHeaders(): Record<string, string> {
		return {
			'Authorization': `Bearer ${getDardcorRouterApiKey()}`
		};
	}

	protected override getCompletionsCallback(): RawMessageConversionCallback | undefined {
		return (out, data) => {
			if (data && data.id) {
				out.reasoning_opaque = data.id;
				out.reasoning_text = Array.isArray(data.text) ? data.text.join('') : data.text;
			}
		};
	}
}

export class DardcorUtilitySmallChatEndpoint {
	static readonly preferredFamily: string = CHAT_MODEL.GPT4OMINI;

	static async resolve(modelFetcher: IModelMetadataFetcher, instantiationService: IInstantiationService): Promise<IChatEndpoint> {
		let modelMetadata: IChatModelInformation;
		try {
			const models = await modelFetcher.getAllChatModels();
			modelMetadata = models.find(model => model.capabilities.family === DardcorUtilitySmallChatEndpoint.preferredFamily
				|| model.id.toLowerCase().endsWith(`/${DardcorUtilitySmallChatEndpoint.preferredFamily.toLowerCase()}`))
				?? models.find(model => /mini|flash|haiku|small|fast/i.test(model.id))
				?? await modelFetcher.getDardcorUtilityModel();
		} catch {
			modelMetadata = await modelFetcher.getDardcorUtilityModel();
		}
		return instantiationService.createInstance(DardcorChatEndpoint, modelMetadata);
	}
}

export class DardcorUtilityChatEndpoint {
	static async resolve(modelFetcher: IModelMetadataFetcher, instantiationService: IInstantiationService): Promise<IChatEndpoint> {
		const modelMetadata = await modelFetcher.getDardcorUtilityModel();
		return instantiationService.createInstance(DardcorChatEndpoint, modelMetadata);
	}
}
