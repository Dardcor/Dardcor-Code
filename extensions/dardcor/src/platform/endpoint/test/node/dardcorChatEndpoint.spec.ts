/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LanguageModelChat } from 'vscode';
import { describe, expect, test } from 'vitest';
import { IInstantiationService } from '../../../../util/dardcor/platform/instantiation/common/instantiation';
import { CHAT_MODEL } from '../../../configuration/common/configurationService';
import { IChatModelInformation } from '../../common/endpointProvider';
import { IModelMetadataFetcher } from '../../node/modelMetadataFetcher';
import { DardcorUtilityChatEndpoint, DardcorUtilitySmallChatEndpoint } from '../../node/dardcorChatEndpoint';

function chatModel(id: string, family: string, isChatFallback = false): IChatModelInformation {
	return {
		id,
		vendor: 'openai',
		name: id,
		version: '1.0',
		model_picker_enabled: false,
		is_chat_default: false,
		is_chat_fallback: isChatFallback,
		capabilities: {
			type: 'chat',
			family,
			tokenizer: 'o200k_base' as any,
			limits: { max_prompt_tokens: 8192, max_output_tokens: 4096 },
			supports: { streaming: undefined },
		},
	};
}

class FakeModelMetadataFetcher implements IModelMetadataFetcher {
	private readonly _byFamily = new Map<string, IChatModelInformation[]>();
	private _utilityModel: IChatModelInformation | undefined;

	constructor(models: IChatModelInformation[]) {
		for (const model of models) {
			const family = model.capabilities.family;
			const list = this._byFamily.get(family) ?? [];
			list.push(model);
			this._byFamily.set(family, list);
			if (model.is_chat_fallback) {
				this._utilityModel = model;
			}
		}
	}

	onDidModelsRefresh = (() => { }) as any;

	async getAllCompletionModels(): Promise<any> { return []; }
	async getAllChatModels(): Promise<IChatModelInformation[]> {
		return Array.from(this._byFamily.values()).flat();
	}
	async getChatModelFromApiModel(_model: LanguageModelChat): Promise<IChatModelInformation | undefined> { return undefined; }
	async getEmbeddingsModel(): Promise<any> { throw new Error('not implemented'); }

	async getDardcorUtilityModel(): Promise<IChatModelInformation> {
		if (!this._utilityModel) {
			throw new Error('Unable to resolve the Dardcor Router utility model.');
		}
		return this._utilityModel;
	}

	async getChatModelFromRouterModel(family: string): Promise<IChatModelInformation> {
		const resolved = this._byFamily.get(family)?.[0];
		if (!resolved) {
			throw new Error(`Unable to resolve Dardcor Router model: ${family}`);
		}
		return resolved;
	}
}

function fakeInstantiationService(): { service: IInstantiationService; lastModel: () => IChatModelInformation | undefined } {
	let last: IChatModelInformation | undefined;
	const service = {
		createInstance: (_ctor: unknown, modelMetadata: IChatModelInformation) => {
			last = modelMetadata;
			return { model: modelMetadata.id } as any;
		},
	} as unknown as IInstantiationService;
	return { service, lastModel: () => last };
}

describe('DardcorUtilitySmallChatEndpoint.resolve (issue #321184)', () => {
	test('falls back to the base utility model when the gpt-4o-mini model is absent from /v1/models', async () => {
		const fetcher = new FakeModelMetadataFetcher([
			chatModel('gpt-4.1', 'gpt-4.1', true),
		]);
		const { service, lastModel } = fakeInstantiationService();

		await expect(fetcher.getChatModelFromRouterModel(CHAT_MODEL.GPT4OMINI)).rejects.toThrow(
			'Unable to resolve Dardcor Router model: gpt-4o-mini'
		);

		await DardcorUtilitySmallChatEndpoint.resolve(fetcher, service);

		expect(lastModel()?.id).toBe('gpt-4.1');
	});

	test('uses the gpt-4o-mini family when it is present', async () => {
		const fetcher = new FakeModelMetadataFetcher([
			chatModel('gpt-4o-mini', CHAT_MODEL.GPT4OMINI),
			chatModel('gpt-4.1', 'gpt-4.1', true),
		]);
		const { service, lastModel } = fakeInstantiationService();

		await DardcorUtilitySmallChatEndpoint.resolve(fetcher, service);

		expect(lastModel()?.id).toBe('gpt-4o-mini');
	});

	test('sibling DardcorUtilityChatEndpoint.resolve already degrades gracefully', async () => {
		const fetcher = new FakeModelMetadataFetcher([
			chatModel('gpt-4.1', 'gpt-4.1', true),
		]);
		const { service, lastModel } = fakeInstantiationService();

		await DardcorUtilityChatEndpoint.resolve(fetcher, service);

		expect(lastModel()?.id).toBe('gpt-4.1');
	});
});
