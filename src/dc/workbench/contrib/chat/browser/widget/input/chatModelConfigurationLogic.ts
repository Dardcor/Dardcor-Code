/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { IJSONSchema } from '../../../../../../base/common/jsonSchema.js';
import { ILanguageModelConfigurationSchema } from '../../../common/languageModels.js';

export function extractSchemaDefaults(schema: ILanguageModelConfigurationSchema | undefined): IStringDictionary<unknown> {
	const defaults: IStringDictionary<unknown> = {};
	if (schema?.properties) {
		for (const [key, propSchema] of Object.entries(schema.properties)) {
			if (propSchema.default !== undefined) {
				defaults[key] = propSchema.default;
			}
		}
	}
	return defaults;
}

export function filterConfigurationToSchema(
	values: IStringDictionary<unknown>,
	schema: ILanguageModelConfigurationSchema | undefined,
): IStringDictionary<unknown> {
	const properties = schema?.properties;
	if (!properties) {
		return {};
	}
	const result: IStringDictionary<unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		const propSchema = Object.hasOwn(properties, key) ? properties[key] : undefined;
		if (!propSchema) {
			continue;
		}
		if (satisfiesPropertySchema(value, propSchema)) {
			result[key] = value;
		}
	}
	return result;
}

function satisfiesPropertySchema(value: unknown, schema: IJSONSchema): boolean {
	if (schema.anyOf || schema.oneOf || schema.allOf || schema.not || schema.$ref) {
		return false;
	}
	if (schema.const !== undefined && value !== schema.const) {
		return false;
	}
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		return false;
	}
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some(type => matchesJSONSchemaType(value, type))) {
			return false;
		}
	}
	if (typeof value === 'number') {
		const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined;
		const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined;
		if ((schema.minimum !== undefined && value < schema.minimum)
			|| (schema.maximum !== undefined && value > schema.maximum)
			|| (exclusiveMinimum !== undefined && value <= exclusiveMinimum)
			|| (exclusiveMaximum !== undefined && value >= exclusiveMaximum)) {
			return false;
		}
	}
	if (typeof value === 'string') {
		if ((schema.minLength !== undefined && value.length < schema.minLength)
			|| (schema.maxLength !== undefined && value.length > schema.maxLength)) {
			return false;
		}
		if (schema.pattern !== undefined) {
			try {
				if (!new RegExp(schema.pattern).test(value)) {
					return false;
				}
			} catch {
				return false;
			}
		}
	}
	return true;
}

function matchesJSONSchemaType(value: unknown, type: string): boolean {
	switch (type) {
		case 'string': return typeof value === 'string';
		case 'number': return typeof value === 'number' && Number.isFinite(value);
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'boolean': return typeof value === 'boolean';
		case 'null': return value === null;
		case 'array': return Array.isArray(value);
		case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
		default: return false;
	}
}





















export function resolveModelConfiguration(
	storedEntry: IStringDictionary<unknown> | undefined,
	schemaDefaults: IStringDictionary<unknown>,
	globalConfig: IStringDictionary<unknown> | undefined,
): IStringDictionary<unknown> {
	if (storedEntry) {
		return { ...schemaDefaults, ...storedEntry };
	}
	return globalConfig ? { ...schemaDefaults, ...globalConfig } : { ...schemaDefaults };
}










export function computeStoredConfiguration(
	current: IStringDictionary<unknown>,
	values: IStringDictionary<unknown>,
	schemaDefaults: IStringDictionary<unknown>,
): IStringDictionary<unknown> {
	const merged = { ...current, ...values };
	const stripped: IStringDictionary<unknown> = {};
	for (const [key, value] of Object.entries(merged)) {
		if (schemaDefaults[key] !== value) {
			stripped[key] = value;
		}
	}
	return stripped;
}
