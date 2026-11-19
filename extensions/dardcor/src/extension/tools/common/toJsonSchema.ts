/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JsonSchema, JsonSchemaType } from '../../../platform/configuration/common/jsonSchema';

export interface IToJsonSchemaOptions {
	includeDescription?: boolean;
}

export function toJsonSchema(obj: unknown, options: IToJsonSchemaOptions = {}): JsonSchema {
	if (obj === null) {
		return { type: 'null' as JsonSchemaType };
	}

	switch (typeof obj) {
		case 'string':
			return { type: 'string' };
		case 'number':
			return { type: Number.isInteger(obj) ? 'integer' : 'number' };
		case 'boolean':
			return { type: 'boolean' as JsonSchemaType };
		case 'object':
			if (Array.isArray(obj)) {
				return toArraySchema(obj, options);
			}
			return toObjectSchema(obj as Record<string, unknown>, options);
		default:
			return {};
	}
}

function toArraySchema(arr: unknown[], options: IToJsonSchemaOptions): JsonSchema {
	if (arr.length === 0) {
		return { type: 'array' };
	}

	const allObjects = arr.every(item => item !== null && typeof item === 'object' && !Array.isArray(item));

	if (allObjects) {
		const itemSchema = mergeObjectSchemas(arr as Record<string, unknown>[], options);
		return {
			type: 'array',
			items: itemSchema,
		};
	}

	const schemas = getUniqueSchemas(arr, options);

	if (schemas.length === 1) {
		return {
			type: 'array',
			items: schemas[0],
		};
	}

	return {
		type: 'array',
		items: { oneOf: schemas },
	};
}

function getSchemaKey(schema: JsonSchema): string {
	if ('type' in schema) {
		if (schema.type === 'object') {
			return 'object';
		}
		if (schema.type === 'array') {
			return 'array';
		}
		return String(schema.type);
	}
	return JSON.stringify(schema);
}

function getUniqueSchemas(arr: unknown[], options: IToJsonSchemaOptions): JsonSchema[] {
	const schemaMap = new Map<string, JsonSchema>();
	const objectValues: Record<string, unknown>[] = [];

	for (const item of arr) {
		if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
			objectValues.push(item as Record<string, unknown>);
			continue;
		}

		const schema = toJsonSchema(item, options);
		const key = getSchemaKey(schema);
		if (!schemaMap.has(key)) {
			schemaMap.set(key, schema);
		}
	}

	if (objectValues.length > 0) {
		schemaMap.set('object', mergeObjectSchemas(objectValues, options));
	}

	return Array.from(schemaMap.values());
}

function mergeObjectSchemas(objects: Record<string, unknown>[], options: IToJsonSchemaOptions): JsonSchema {
	const propertyValues = new Map<string, unknown[]>();

	for (const obj of objects) {
		for (const [key, value] of Object.entries(obj)) {
			if (!propertyValues.has(key)) {
				propertyValues.set(key, []);
			}
			propertyValues.get(key)!.push(value);
		}
	}

	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const [key, values] of propertyValues) {
		properties[key] = mergeValues(values, options);
		if (values.length === objects.length) {
			required.push(key);
		}
	}

	const schema: JsonSchema = {
		type: 'object',
		properties,
	};

	if (required.length > 0) {
		(schema as { required?: string[] }).required = required;
	}

	return schema;
}

function mergeValues(values: unknown[], options: IToJsonSchemaOptions): JsonSchema {
	const allObjects = values.every(v => v !== null && typeof v === 'object' && !Array.isArray(v));

	if (allObjects) {
		return mergeObjectSchemas(values as Record<string, unknown>[], options);
	}

	const schemas = getUniqueSchemas(values, options);

	if (schemas.length === 1) {
		return schemas[0];
	}

	return { oneOf: schemas };
}

function toObjectSchema(obj: Record<string, unknown>, options: IToJsonSchemaOptions): JsonSchema {
	const properties: Record<string, JsonSchema> = {};
	const required: string[] = [];

	for (const [key, value] of Object.entries(obj)) {
		properties[key] = toJsonSchema(value, options);
		required.push(key);
	}

	const schema: JsonSchema = {
		type: 'object',
		properties,
	};

	if (required.length > 0) {
		(schema as { required?: string[] }).required = required;
	}

	return schema;
}
