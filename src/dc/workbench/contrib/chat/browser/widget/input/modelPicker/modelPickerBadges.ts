/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../../../nls.js';
import { ILanguageModelChatMetadata, ILanguageModelChatMetadataAndIdentifier } from '../../../../common/languageModels.js';
import { getModelConfigSummary, IModelConfigurationAccess } from './modelPickerModelConfig.js';

export const enum ModelBadgeTone {
	Neutral = 'neutral',
	Selected = 'selected',
	Promo = 'promo',
	Warning = 'warning',
}

export interface IModelBadge {
	readonly text: string;
	readonly tone: ModelBadgeTone;
}

const DEPRECATION_WARNING_CODES: ReadonlySet<string> = new Set(['model_pending_deprecation', 'model_deprecated']);

export interface IModelBadgeContext {
	readonly configurationAccess: IModelConfigurationAccess;
	readonly providerLabel?: string;
}

export function getModelBadge(
	model: ILanguageModelChatMetadataAndIdentifier,
	context: IModelBadgeContext,
): IModelBadge | undefined {
	if (isDeprecated(model)) {
		return { text: localize('chat.modelPicker.badge.deprecated', "Retiring"), tone: ModelBadgeTone.Warning };
	}
	const promo = ILanguageModelChatMetadata.hasPromoDiscount(model.metadata) ? model.metadata.promo : undefined;
	if (promo) {
		return { text: localize('chat.modelPicker.badge.promo', "{0}% off", promo.discountPercent), tone: ModelBadgeTone.Promo };
	}
	const summary = getModelConfigSummary(model, context.configurationAccess);
	if (summary) {
		return { text: summary, tone: ModelBadgeTone.Selected };
	}
	return context.providerLabel ? { text: context.providerLabel, tone: ModelBadgeTone.Neutral } : undefined;
}

export function isDeprecated(model: ILanguageModelChatMetadataAndIdentifier): boolean {
	return Object.keys(model.metadata.warningText ?? {}).some(code => DEPRECATION_WARNING_CODES.has(code));
}
