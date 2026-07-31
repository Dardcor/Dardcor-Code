/**
 * Dardcor Code - Configuration JSON Schema Generator (Task 187)
 * Mirrors: vs/platform/configuration/common/configurationRegistry.ts JSON Schema generation
 */

import { IConfigurationPropertySchema, getConfigurationRegistry } from './config-registry';

export function generateSettingsJSONSchema(): any {
	const props = getConfigurationRegistry().getConfigurationProperties();
	const propertiesSchema: Record<string, any> = {};

	for (const [key, prop] of Object.entries(props)) {
		const entry: Record<string, any> = {
			type: prop.type,
			default: prop.default,
			description: prop.description,
		};
		if (prop.enum) entry.enum = prop.enum;
		if (prop.enumDescriptions) entry.enumDescriptions = prop.enumDescriptions;
		if (prop.minimum !== undefined) entry.minimum = prop.minimum;
		if (prop.maximum !== undefined) entry.maximum = prop.maximum;
		propertiesSchema[key] = entry;
	}

	return {
		$schema: 'http://json-schema.org/draft-07/schema#',
		title: 'Dardcor Code Configuration Schema',
		type: 'object',
		properties: propertiesSchema,
		additionalProperties: false,
	};
}
