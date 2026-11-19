/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';

const FAST_VARIANT_SUFFIX = '-fast';

export interface IModelSpeedVariants {
	readonly standard: ILanguageModelChatMetadataAndIdentifier;
	readonly fast: ILanguageModelChatMetadataAndIdentifier;
}

export function buildSpeedVariants(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
): ReadonlyMap<string, IModelSpeedVariants> {
	const key = (model: ILanguageModelChatMetadataAndIdentifier, id: string) => `${model.metadata.vendor}/${id}`;
	const byModelId = new Map<string, ILanguageModelChatMetadataAndIdentifier>();
	for (const model of models) {
		byModelId.set(key(model, model.metadata.id), model);
	}

	const pairs = new Map<string, IModelSpeedVariants>();
	for (const model of models) {
		const id = model.metadata.id;
		if (!id.endsWith(FAST_VARIANT_SUFFIX)) {
			continue;
		}
		const standard = byModelId.get(key(model, id.slice(0, -FAST_VARIANT_SUFFIX.length)));
		if (!standard) {
			continue;
		}
		const pair: IModelSpeedVariants = { standard, fast: model };
		pairs.set(standard.identifier, pair);
		pairs.set(model.identifier, pair);
	}
	return pairs;
}

export function collapseSpeedVariants(
	models: readonly ILanguageModelChatMetadataAndIdentifier[],
	variants: ReadonlyMap<string, IModelSpeedVariants>,
	selectedModelId: string | undefined,
): ILanguageModelChatMetadataAndIdentifier[] {
	if (!variants.size) {
		return [...models];
	}
	return models.filter(model => {
		const pair = variants.get(model.identifier);
		if (!pair) {
			return true;
		}
		const inUse = selectedModelId === pair.fast.identifier ? pair.fast : pair.standard;
		return model.identifier === inUse.identifier;
	});
}
