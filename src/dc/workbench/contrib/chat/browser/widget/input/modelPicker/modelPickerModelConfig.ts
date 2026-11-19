/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatTokenCount } from '../../../../../../../base/common/numbers.js';
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelConfigurationSchema, type IModelConfigurationAccess } from '../../../../common/languageModels.js';

export type { IModelConfigurationAccess } from '../../../../common/languageModels.js';

export const MODEL_CONFIG_GROUP_EFFORT = 'navigation';
export const MODEL_CONFIG_GROUP_CONTEXT = 'tokens';

export type IModelConfigPropertySchema = NonNullable<ILanguageModelConfigurationSchema['properties']>[string];

export interface IModelConfigProperty {
	readonly key: string;
	readonly value: unknown;
	readonly schema: IModelConfigPropertySchema;
}

export function getModelConfigProperty(
	model: ILanguageModelChatMetadataAndIdentifier | undefined,
	configurationAccess: IModelConfigurationAccess,
	group: string,
): IModelConfigProperty | undefined {
	const properties = model?.metadata.configurationSchema?.properties;
	if (!properties) {
		return undefined;
	}
	const currentConfig = configurationAccess.getModelConfiguration(model.identifier) ?? {};
	for (const [key, schema] of Object.entries(properties)) {
		if (schema.group !== group || !schema.enum?.length) {
			continue;
		}
		return { key, value: currentConfig[key] ?? schema.default, schema };
	}
	return undefined;
}

export function getModelConfigValueLabel(schema: IModelConfigPropertySchema, value: unknown): string {
	const index = schema.enum?.indexOf(value) ?? -1;
	const label = index >= 0 ? schema.enumItemLabels?.[index] : undefined;
	return label ?? (typeof value === 'number' ? formatTokenCount(value) : String(value));
}

export function isExtendedContext(property: IModelConfigProperty): boolean {
	const values = property.schema.enum ?? [];
	return values.length > 1 && property.value === values[values.length - 1];
}

export function getModelConfigSummary(
	model: ILanguageModelChatMetadataAndIdentifier | undefined,
	configurationAccess: IModelConfigurationAccess,
): string | undefined {
	const parts: string[] = [];
	for (const group of [MODEL_CONFIG_GROUP_EFFORT, MODEL_CONFIG_GROUP_CONTEXT]) {
		const property = getModelConfigProperty(model, configurationAccess, group);
		if (!property || property.value === undefined || property.value === property.schema.default) {
			continue;
		}
		parts.push(getModelConfigValueLabel(property.schema, property.value));
	}
	return parts.length ? parts.join(' \u00b7 ') : undefined;
}
