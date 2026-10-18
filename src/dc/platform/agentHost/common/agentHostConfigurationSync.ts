/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { AgentHostConfigurationSyncScope, Extensions as ConfigurationExtensions, IAgentHostConfigurationSync, IConfigurationPropertySchema, IConfigurationRegistry } from '../../configuration/common/configurationRegistry.js';
import { Registry } from '../../registry/common/platform.js';
import { AgentHostResourceIdentity, LOCAL_AGENT_HOST_RESOURCE_IDENTITY } from './agentHostResourceService.js';

function getRegistry(): IConfigurationRegistry {
	return Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
}

function getPropertySchema(settingId: string): IConfigurationPropertySchema | undefined {
	const registry = getRegistry();
	return registry.getConfigurationProperties()[settingId] ?? registry.getExcludedConfigurationProperties()[settingId];
}

function matchesSchemaType(value: unknown, type: IConfigurationPropertySchema['type']): boolean {
	if (type === undefined) {
		return true;
	}
	if (Array.isArray(type)) {
		return type.some(candidate => matchesSchemaType(value, candidate));
	}
	switch (type) {
		case 'boolean': return typeof value === 'boolean';
		case 'string': return typeof value === 'string';
		case 'number': return typeof value === 'number';
		case 'integer': return typeof value === 'number' && Number.isInteger(value);
		case 'array': return Array.isArray(value);
		case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
		case 'null': return value === null;
		default: return true;
	}
}

export function getGlobalConfigurationValue<T>(configurationService: IConfigurationService, settingId: string): T | undefined {
	const inspected = configurationService.inspect<T>(settingId);
	const property = getPropertySchema(settingId);
	for (const value of [inspected.policyValue, inspected.userValue, inspected.applicationValue]) {
		if (value !== undefined && matchesSchemaType(value, property?.type)) {
			return value;
		}
	}
	return inspected.defaultValue ?? property?.default as T | undefined;
}

export function inspectValue<T>(configurationService: IConfigurationService, settingId: string): readonly [value: T, source: 'policyValue' | 'userValue' | 'applicationValue'] | undefined {
	const inspected = configurationService.inspect<T>(settingId);
	const property = getPropertySchema(settingId);
	const values = [
		['policyValue', inspected.policyValue],
		['userValue', inspected.userValue],
		['applicationValue', inspected.applicationValue],
	] as const;
	for (const [source, value] of values) {
		if (value !== undefined && matchesSchemaType(value, property?.type)) {
			return [value, source];
		}
	}
	return undefined;
}

export interface IAgentHostConfigurationSyncEntry {
	readonly settingId: string;
	readonly sync: IAgentHostConfigurationSync;
}

export const enum AgentHostConfigurationSyncTarget {
	Local,
	RemoteExtensionHost,
	Remote,
}

export function getAgentHostConfigurationSyncTarget(identity: AgentHostResourceIdentity): AgentHostConfigurationSyncTarget {
	if (identity === LOCAL_AGENT_HOST_RESOURCE_IDENTITY) {
		return AgentHostConfigurationSyncTarget.Local;
	}
	return URI.parse(identity).scheme === Schemas.vscodeRemote
		? AgentHostConfigurationSyncTarget.RemoteExtensionHost
		: AgentHostConfigurationSyncTarget.Remote;
}

function includesTarget(scope: AgentHostConfigurationSyncScope | undefined, target: AgentHostConfigurationSyncTarget): boolean {
	switch (scope ?? AgentHostConfigurationSyncScope.All) {
		case AgentHostConfigurationSyncScope.All:
			return true;
		case AgentHostConfigurationSyncScope.Local:
			return target === AgentHostConfigurationSyncTarget.Local;
		case AgentHostConfigurationSyncScope.Ambient:
			return target === AgentHostConfigurationSyncTarget.Local || target === AgentHostConfigurationSyncTarget.RemoteExtensionHost;
	}
}

export function getAgentHostConfigurationSyncEntries(target: AgentHostConfigurationSyncTarget): IAgentHostConfigurationSyncEntry[] {
	const entries: IAgentHostConfigurationSyncEntry[] = [];
	for (const [settingId, sync] of getRegistry().getAgentHostSyncConfigurations()) {
		if (!includesTarget(sync.scope, target)) {
			continue;
		}
		entries.push({ settingId, sync });
	}
	return entries;
}

export function resolveAgentHostConfigurationSyncValue(configurationService: IConfigurationService, entry: IAgentHostConfigurationSyncEntry): unknown {
	const value = getGlobalConfigurationValue(configurationService, entry.settingId);
	return entry.sync.transform ? entry.sync.transform(value) : value;
}

export function formatAgentHostConfigurationSyncValueForLog(settingId: string, value: unknown): string {
	if (typeof value === 'boolean' || typeof value === 'number') {
		return String(value);
	}
	const property = getPropertySchema(settingId);
	if (typeof value === 'string' && property?.enum?.includes(value)) {
		return value;
	}
	return `<${Array.isArray(value) ? 'array' : typeof value}>`;
}

export function resolveAgentHostConfigurationSyncPatch(configurationService: IConfigurationService, target: AgentHostConfigurationSyncTarget): Record<string, unknown> {
	const patch: Record<string, unknown> = {};
	for (const entry of getAgentHostConfigurationSyncEntries(target)) {
		const value = resolveAgentHostConfigurationSyncValue(configurationService, entry);
		// A setting with no value in any global layer and no registered default has
		if (value !== undefined) {
			patch[entry.sync.key] = value;
		}
	}
	return patch;
}
