/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IPolicyData } from '../../../base/common/defaultAccount.js';
import { ExtraKnownMarketplacesConfigDict, IExtraKnownMarketplaceEntry, extraKnownMarketplacesToConfigDict } from '../../../base/common/managedSettings.js';
import { IManagedSettingPolicyDefinition, IManagedSettingsPolicyDefinitions, ManagedSettingValue, ManagedSettingsData } from '../../../base/common/policy.js';
import { IStringDictionary } from '../../../base/common/collections.js';
import { isEmptyObject, isObject, isString } from '../../../base/common/types.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { PolicyDefinition } from './policy.js';

export type { ManagedSettingsData } from '../../../base/common/policy.js';

export type RawManagedSettingsData = Readonly<Record<string, unknown>>;

export function hasRawManagedSettings(data: RawManagedSettingsData | undefined): boolean {
	return data !== undefined && Object.keys(data).length > 0;
}

export const GITHUB_COPILOT_WIN32_REGISTRY_PATH = 'SOFTWARE\\Policies\\GitHubCopilot';

export const GITHUB_COPILOT_WIN32_POLICY_NAME = 'GitHubCopilot';

export const GITHUB_COPILOT_MACOS_BUNDLE_ID = 'com.github.copilot';

export const COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY = 'permissions.disableBypassPermissionsMode';

export const COPILOT_ENABLED_PLUGINS_KEY = 'enabledPlugins';

export const COPILOT_EXTRA_MARKETPLACES_KEY = 'extraKnownMarketplaces';

export const COPILOT_STRICT_MARKETPLACES_KEY = 'strictKnownMarketplaces';

export const COPILOT_ALLOWED_MCP_SERVERS_KEY = 'allowedMcpServers';

export const COPILOT_DENIED_MCP_SERVERS_KEY = 'deniedMcpServers';

export const COPILOT_STRICT_PLUGIN_ONLY_CUSTOMIZATION_KEY = 'strictPluginOnlyCustomization';

export const COPILOT_ALLOW_MANAGED_MCP_SERVERS_ONLY_KEY = 'allowManagedMcpServersOnly';

export const COPILOT_ALLOW_MANAGED_HOOKS_ONLY_KEY = 'allowManagedHooksOnly';

export const COPILOT_FORCE_REMOTE_SETTINGS_REFRESH_KEY = 'forceRemoteSettingsRefresh';

export function shouldForceRemoteSettingsRefresh(nativeSettings: RawManagedSettingsData | undefined, serverSettings: RawManagedSettingsData | undefined): boolean {
	const nativeValue = nativeSettings?.[COPILOT_FORCE_REMOTE_SETTINGS_REFRESH_KEY];
	if (typeof nativeValue === 'boolean') {
		return nativeValue;
	}
	const serverValue = serverSettings?.[COPILOT_FORCE_REMOTE_SETTINGS_REFRESH_KEY];
	if (typeof serverValue === 'boolean') {
		return serverValue;
	}
	return false;
}

export const COPILOT_SANDBOX_ENABLED_KEY = 'sandbox.enabled';

export const COPILOT_SANDBOX_ALLOW_BYPASS_KEY = 'sandbox.allowBypass';

export const MANAGED_SETTINGS_CONTROL_DEFINITIONS: IManagedSettingsPolicyDefinitions = {
	[COPILOT_FORCE_REMOTE_SETTINGS_REFRESH_KEY]: { type: 'boolean' },
	[COPILOT_SANDBOX_ENABLED_KEY]: { type: 'boolean' },
	[COPILOT_SANDBOX_ALLOW_BYPASS_KEY]: { type: 'boolean' },
};

export const COPILOT_STRICT_PLUGIN_ONLY_CUSTOMIZATION_CONFIG = 'chat.customizations.strictPluginOnlyCustomization';

export const COPILOT_ALLOW_MANAGED_MCP_SERVERS_ONLY_CONFIG = 'chat.mcp.allowManagedServersOnly';

export const COPILOT_ALLOW_MANAGED_HOOKS_ONLY_CONFIG = 'chat.hooks.allowManagedOnly';

export const COPILOT_MODEL_KEY = 'permissions.model';

export const COPILOT_TOP_LEVEL_MODEL_KEY = 'model';


export const DARDCOR_OTEL_ENABLED_KEY = 'telemetry.enabled';

export const DARDCOR_OTEL_ENDPOINT_KEY = 'telemetry.endpoint';

export const DARDCOR_OTEL_PROTOCOL_KEY = 'telemetry.protocol';

export const DARDCOR_OTEL_CAPTURE_CONTENT_KEY = 'telemetry.captureContent';

export const DARDCOR_OTEL_LOCK_CAPTURE_CONTENT_KEY = 'telemetry.lockCaptureContent';

export const DARDCOR_OTEL_SERVICE_NAME_KEY = 'telemetry.serviceName';

export const DARDCOR_OTEL_RESOURCE_ATTRIBUTES_KEY = 'telemetry.resourceAttributes';

export const DARDCOR_OTEL_HEADERS_KEY = 'telemetry.headers';

const managedSettingValueCallbacks = new Map<string, (policyData: IPolicyData) => ManagedSettingValue | undefined>();

export function managedSettingValue(key: string): (policyData: IPolicyData) => ManagedSettingValue | undefined {
	let callback = managedSettingValueCallbacks.get(key);
	if (!callback) {
		callback = policyData => policyData.managedSettings?.[key];
		managedSettingValueCallbacks.set(key, callback);
	}
	return callback;
}

export type IForceRemoteSettingsRefreshResolution =
	| { readonly effective: true; readonly source: ManagedSettingsChannel }
	| { readonly effective: false };

export function resolveForceRemoteSettingsRefresh(nativeMdm: ManagedSettingsData | undefined, server: ManagedSettingsData | undefined, file: ManagedSettingsData | undefined): IForceRemoteSettingsRefreshResolution {
	const resolution = pickManagedSettings(nativeMdm, server, file).resolutions.get(COPILOT_FORCE_REMOTE_SETTINGS_REFRESH_KEY);
	const contribution = resolution?.contributions.find(candidate => typeof candidate.value === 'boolean');
	if (!contribution) {
		return { effective: false };
	}
	return contribution.value === true
		? { effective: true, source: contribution.channel }
		: { effective: false };
}

export const IManagedSettingsService = createDecorator<IManagedSettingsService>('managedSettingsService');

export interface IManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeManagedSettings: Event<void>;
	getManagedSettingValue(key: string): ManagedSettingValue | undefined;
}

export class NullManagedSettingsService implements IManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeManagedSettings = Event.None;

	getManagedSettingValue(): ManagedSettingValue | undefined {
		return undefined;
	}
}

let managedModelValueCallback: ((policyData: IPolicyData) => ManagedSettingValue | undefined) | undefined;

function normalizeModelValue(value: ManagedSettingValue | undefined): string | undefined {
	const trimmed = typeof value === 'string' ? value.trim() : undefined;
	return trimmed ? trimmed : undefined;
}

export function managedModelValue(): (policyData: IPolicyData) => ManagedSettingValue | undefined {
	if (!managedModelValueCallback) {
		managedModelValueCallback = policyData => {
			const topLevel = normalizeModelValue(policyData.managedSettings?.[COPILOT_TOP_LEVEL_MODEL_KEY]);
			return topLevel ?? normalizeModelValue(policyData.managedSettings?.[COPILOT_MODEL_KEY]);
		};
	}
	return managedModelValueCallback;
}

export function managedSettingsDisabledValue(policyData: IPolicyData): boolean | undefined {
	return policyData.managedSettingsActive === true ? false : undefined;
}

export function thirdPartyAgentEnabledValue(policyData: IPolicyData): boolean | undefined {
	return policyData.chat_preview_features_enabled === false ? false : managedSettingsDisabledValue(policyData);
}

export const INativeManagedSettingsService = createDecorator<INativeManagedSettingsService>('nativeManagedSettingsService');

export interface INativeManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData;
	readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
	initialize(): Promise<ManagedSettingsData>;
	updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<ManagedSettingsData>;
}

export class NullNativeManagedSettingsService implements INativeManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly managedSettings: ManagedSettingsData = {};
	readonly onDidChangeManagedSettings = Event.None;

	async initialize(): Promise<ManagedSettingsData> { return this.managedSettings; }
	async updatePolicyDefinitions(): Promise<ManagedSettingsData> { return this.managedSettings; }
}

function flattenManagedSettings(object: unknown): Record<string, string | number | boolean> {
	const result: Record<string, string | number | boolean> = {};
	flattenManagedSettingsValue(object, undefined, result);
	return result;
}

function flattenManagedSettingsValue(value: unknown, prefix: string | undefined, result: Record<string, string | number | boolean>): void {
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		if (prefix !== undefined) {
			result[prefix] = value;
		}
		return;
	}

	if (!isManagedSettingsObject(value)) {
		return;
	}

	for (const key in value) {
		flattenManagedSettingsValue(value[key], prefix ? `${prefix}.${key}` : key, result);
	}
}

function isManagedSettingsObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectManagedSettingsDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): IManagedSettingsPolicyDefinitions {
	const definitions: Record<string, IManagedSettingPolicyDefinition> = {};
	for (const policyName in policyDefinitions) {
		const policyManagedSettings = policyDefinitions[policyName].managedSettings;
		if (policyManagedSettings) {
			for (const key in policyManagedSettings) {
				definitions[key] = policyManagedSettings[key];
			}
		}
	}
	return definitions;
}

export function hasManagedSettingsDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): boolean {
	for (const policyName in policyDefinitions) {
		const policyManagedSettings = policyDefinitions[policyName].managedSettings;
		if (policyManagedSettings && !isEmptyObject(policyManagedSettings)) {
			return true;
		}
	}
	return false;
}

export function projectManagedSettings(values: ManagedSettingsData, definitions: IManagedSettingsPolicyDefinitions, onWarn?: (msg: string) => void): ManagedSettingsData {
	const projected: Record<string, ManagedSettingValue> = {};
	for (const key in definitions) {
		const value = values[key];
		if (value === undefined) {
			continue;
		}
		if (typeof value === definitions[key].type) {
			projected[key] = value;
		} else {
			onWarn?.(`Ignoring managed setting "${key}": expected ${definitions[key].type}, got ${typeof value}`);
		}
	}
	return projected;
}

export type ManagedSettingsChannel =
	| 'server'
	| 'nativeMdm'
	| 'file';

export type ManagedSettingsSource = ManagedSettingsChannel | 'none';

export const MANAGED_SETTINGS_CHANNELS: readonly ManagedSettingsChannel[] = ['nativeMdm', 'server', 'file'];

export interface IManagedSettingsContribution {
	readonly channel: ManagedSettingsChannel;
	readonly value: ManagedSettingValue;
}

export interface IManagedSettingResolution {
	readonly value: ManagedSettingValue;
	readonly source: ManagedSettingsChannel;
	readonly contributions: readonly IManagedSettingsContribution[];
}

export interface IManagedSettingsPick {
	readonly values: ManagedSettingsData;
	readonly resolutions: ReadonlyMap<string, IManagedSettingResolution>;
	readonly activeSources: readonly ManagedSettingsChannel[];
}

export function pickManagedSettings(nativeMdm: ManagedSettingsData | undefined, server: ManagedSettingsData | undefined, file: ManagedSettingsData | undefined): IManagedSettingsPick {
	const bags: Record<ManagedSettingsChannel, ManagedSettingsData | undefined> = { nativeMdm, server, file };

	const resolutions = new Map<string, { value: ManagedSettingValue; source: ManagedSettingsChannel; contributions: IManagedSettingsContribution[] }>();
	for (const channel of MANAGED_SETTINGS_CHANNELS) {
		const bag = bags[channel];
		if (!bag) {
			continue;
		}
		for (const key of Object.keys(bag)) {
			const value = bag[key];
			if (value === undefined) {
				continue;
			}
			const existing = resolutions.get(key);
			if (existing) {
				existing.contributions.push({ channel, value });
				if (key === COPILOT_SANDBOX_ENABLED_KEY && value === true && existing.value !== true) {
					existing.value = value;
					existing.source = channel;
				}
			} else {
				resolutions.set(key, { value, source: channel, contributions: [{ channel, value }] });
			}
		}
	}

	const activeSources = new Set<ManagedSettingsChannel>();
	const entries: [string, ManagedSettingValue][] = [];
	for (const [key, resolution] of resolutions) {
		entries.push([key, resolution.value]);
		activeSources.add(resolution.source);
	}

	return {
		values: Object.fromEntries(entries),
		resolutions,
		activeSources: MANAGED_SETTINGS_CHANNELS.filter(channel => activeSources.has(channel)),
	};
}


export const MANAGED_SETTINGS_MACOS_FILE_PATH = '/Library/Application Support/GitHubCopilot/managed-settings.json';

export const MANAGED_SETTINGS_LINUX_FILE_PATH = '/etc/github-copilot/managed-settings.json';

export const MANAGED_SETTINGS_WINDOWS_DIR = 'GitHubCopilot';

export const MANAGED_SETTINGS_FILE_NAME = 'managed-settings.json';

interface IStructuredManagedSetting {
	readonly key: string;
	readonly encode: (value: unknown, onWarn?: (msg: string) => void) => unknown;
}

function encodeStringMap(value: unknown): Record<string, string> | undefined {
	if (!isObject(value)) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(value)) {
		if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
			continue;
		}
		if (isString(v)) {
			out[k] = v;
		} else if (typeof v === 'number' || typeof v === 'boolean') {
			out[k] = String(v);
		}
	}
	return out;
}

function encodeObject(value: unknown): object | undefined {
	return isObject(value) ? value : undefined;
}

function encodeArray(value: unknown): unknown[] | undefined {
	return Array.isArray(value) ? value : undefined;
}

function encodeExtraMarketplaces(value: unknown, onWarn?: (msg: string) => void): ExtraKnownMarketplacesConfigDict | undefined {
	return extraKnownMarketplacesToConfigDict(normalizeExtraKnownMarketplaces(value, onWarn));
}

const STRUCTURED_MANAGED_SETTINGS: readonly IStructuredManagedSetting[] = [
	{
		key: COPILOT_ENABLED_PLUGINS_KEY,
		encode: encodeObject,
	},
	{
		key: COPILOT_STRICT_MARKETPLACES_KEY,
		encode: encodeArray,
	},
	{
		key: COPILOT_ALLOWED_MCP_SERVERS_KEY,
		encode: encodeArray,
	},
	{
		key: COPILOT_DENIED_MCP_SERVERS_KEY,
		encode: encodeArray,
	},
	{
		key: COPILOT_EXTRA_MARKETPLACES_KEY,
		encode: encodeExtraMarketplaces,
	},
	{
		key: DARDCOR_OTEL_RESOURCE_ATTRIBUTES_KEY,
		encode: encodeStringMap,
	},
	{
		key: DARDCOR_OTEL_HEADERS_KEY,
		encode: encodeStringMap,
	},
];

function readNestedManagedKey(obj: Record<string, unknown>, dottedKey: string): unknown {
	let current: unknown = obj;
	for (const segment of dottedKey.split('.')) {
		if (!isObject(current)) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function withNestedManagedKeyDeleted(obj: Record<string, unknown>, dottedKey: string): Record<string, unknown> {
	const dot = dottedKey.indexOf('.');
	if (dot === -1) {
		const clone = { ...obj };
		delete clone[dottedKey];
		return clone;
	}
	const head = dottedKey.slice(0, dot);
	const child = obj[head];
	if (!isObject(child)) {
		return obj;
	}
	return { ...obj, [head]: withNestedManagedKeyDeleted(child as Record<string, unknown>, dottedKey.slice(dot + 1)) };
}

export function normalizeManagedSettings(parsed: Record<string, unknown>, onWarn?: (msg: string) => void): ManagedSettingsData {
	let scalarRest: Record<string, unknown> = { ...parsed };
	for (const setting of STRUCTURED_MANAGED_SETTINGS) {
		scalarRest = withNestedManagedKeyDeleted(scalarRest, setting.key);
	}

	const result: Record<string, ManagedSettingValue> = { ...flattenManagedSettings(scalarRest) };

	for (const setting of STRUCTURED_MANAGED_SETTINGS) {
		const encoded = setting.encode(readNestedManagedKey(parsed, setting.key), onWarn);
		if (encoded !== undefined) {
			result[setting.key] = JSON.stringify(encoded);
		}
	}

	return result;
}

function normalizeExtraKnownMarketplaces(value: unknown, onWarn?: (msg: string) => void): IExtraKnownMarketplaceEntry[] | undefined {
	if (!isObject(value)) {
		return undefined;
	}
	const seen = new Set<string>();
	const entries: IExtraKnownMarketplaceEntry[] = [];
	for (const [name, entry] of Object.entries(value)) {
		if (!isObject(entry) || !isObject((entry as Record<string, unknown>).source)) {
			onWarn?.(`Skipping malformed extraKnownMarketplaces entry "${name}": expected { source: { source, repo|url } }`);
			continue;
		}
		const rawEntry = entry as Record<string, unknown>;
		const src = rawEntry.source as { source?: string; repo?: string; url?: string; ref?: string };
		const autoUpdate = typeof rawEntry.autoUpdate === 'boolean' ? rawEntry.autoUpdate : undefined;
		if (rawEntry.autoUpdate !== undefined && autoUpdate === undefined) {
			onWarn?.(`Ignoring invalid autoUpdate for extraKnownMarketplaces entry "${name}": expected boolean`);
		}
		let normalized: IExtraKnownMarketplaceEntry | undefined;
		if (src.source === 'github' && isString(src.repo)) {
			normalized = { name, ...(autoUpdate === undefined ? {} : { autoUpdate }), source: { source: 'github', repo: src.repo, ...(src.ref ? { ref: src.ref } : {}) } };
		} else if (src.source === 'git' && isString(src.url)) {
			normalized = { name, ...(autoUpdate === undefined ? {} : { autoUpdate }), source: { source: 'git', url: src.url, ...(src.ref ? { ref: src.ref } : {}) } };
		} else if (src.source === 'github' || src.source === 'git') {
			onWarn?.(`Skipping extraKnownMarketplaces entry "${name}": source "${src.source}" requires ${src.source === 'github' ? '"repo"' : '"url"'}`);
		} else {
			onWarn?.(`Skipping extraKnownMarketplaces entry "${name}": unknown source type "${src.source}"`);
		}
		if (normalized && !seen.has(name)) {
			seen.add(name);
			entries.push(normalized);
		}
	}
	return entries;
}

export const IFileManagedSettingsService = createDecorator<IFileManagedSettingsService>('fileManagedSettingsService');

export interface IFileManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly rawManagedSettings: RawManagedSettingsData;
	readonly managedSettings: ManagedSettingsData;
	readonly onDidChangeRawManagedSettings: Event<RawManagedSettingsData>;
	readonly onDidChangeManagedSettings: Event<ManagedSettingsData>;
	initialize(): Promise<ManagedSettingsData>;
}

export class NullFileManagedSettingsService implements IFileManagedSettingsService {
	readonly _serviceBrand: undefined;
	readonly rawManagedSettings: RawManagedSettingsData = {};
	readonly managedSettings: ManagedSettingsData = {};
	readonly onDidChangeRawManagedSettings = Event.None;
	readonly onDidChangeManagedSettings = Event.None;

	async initialize(): Promise<ManagedSettingsData> { return this.managedSettings; }
}
