/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { IConfigurationService } from '../../configuration/common/configuration.js';
import { AgentNetworkDomainSettingId } from '../../networkFilter/common/settings.js';
import { normalizeDomainPattern } from '../../networkFilter/common/domainMatcher.js';
import { buildManagedFamilyRule, buildManagedRule, ManagedRuleFamily } from './agentHostManagedRules.js';
import { getGlobalConfigurationValue, inspectValue } from './agentHostConfigurationSync.js';
import { ELIGIBLE_FOR_AUTO_APPROVAL_SETTING_ID, GLOBAL_AUTO_APPROVE_SETTING_ID, TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID, TERMINAL_AUTO_APPROVE_SETTING_ID, type AgentHostTerminalAutoApproveRules, type AgentHostTerminalAutoApproveRuleValue } from './agentHostSchema.js';

export interface IAgentHostManagedSettingsPermissions {
	disableBypassPermissionsMode?: 'disable';
	deny?: string[];
	ask?: string[];
}

export const AgentHostMapLegacySettingsToManagedSettingsSettingId = 'chat.agentHost.copilot.mapLegacySettingsToManagedSettings';

type ManagedPermissionsSettingSources = 'policyOnly' | 'anyGlobal';

interface IManagedPermissionsSettingMapping {
	readonly settingId: string;
	readonly additionalSettingIds?: readonly string[];
	contribute(configurationService: IConfigurationService): IAgentHostManagedSettingsPermissions | undefined;
}

function managedPermissionsSetting<T>(
	settingId: string,
	sources: ManagedPermissionsSettingSources,
	transform: (value: T) => IAgentHostManagedSettingsPermissions | undefined,
): IManagedPermissionsSettingMapping {
	return {
		settingId,
		contribute: configurationService => {
			const configuration = inspectValue<T>(configurationService, settingId);
			if (configuration === undefined) {
				return undefined;
			}
			const [value, source] = configuration;
			if (sources === 'policyOnly' && source !== 'policyValue') {
				return undefined;
			}
			return transform(value);
		},
	};
}

function managedPermissionsCompositeSetting(
	settingId: string,
	additionalSettingIds: readonly string[],
	contribute: (configurationService: IConfigurationService) => IAgentHostManagedSettingsPermissions | undefined,
): IManagedPermissionsSettingMapping {
	return { settingId, additionalSettingIds, contribute };
}

function contributeNetworkDomainRules(configurationService: IConfigurationService): IAgentHostManagedSettingsPermissions | undefined {
	if (getGlobalConfigurationValue<boolean>(configurationService, AgentNetworkDomainSettingId.NetworkFilter) !== true) {
		return undefined;
	}
	const allowed = getGlobalConfigurationValue<string[]>(configurationService, AgentNetworkDomainSettingId.AllowedNetworkDomains) ?? [];
	const denied = getGlobalConfigurationValue<string[]>(configurationService, AgentNetworkDomainSettingId.DeniedNetworkDomains) ?? [];

	if (allowed.length === 0 && denied.length === 0) {
		return { deny: [buildManagedFamilyRule(ManagedRuleFamily.Domain)] };
	}

	const deny: string[] = [];
	for (const pattern of denied) {
		if (typeof pattern !== 'string') {
			continue;
		}
		const domain = normalizeDomainPattern(pattern);
		if (!domain) {
			continue;
		}
		const rule = domain === '*'
			? buildManagedFamilyRule(ManagedRuleFamily.Domain)
			: buildManagedRule(ManagedRuleFamily.Domain, domain);
		if (rule) {
			deny.push(rule);
		}
	}
	return deny.length > 0 ? { deny } : undefined;
}

function contributeTerminalDenialRules(rules: AgentHostTerminalAutoApproveRules): IAgentHostManagedSettingsPermissions | undefined {
	if (!rules || typeof rules !== 'object') {
		return undefined;
	}
	const ask: string[] = [];
	for (const [command, value] of Object.entries(rules)) {
		if (!isSubCommandDenial(value) || !isLiteralCommandKey(command)) {
			continue;
		}
		const rule = buildManagedRule(ManagedRuleFamily.Shell, command);
		if (rule) {
			ask.push(rule);
		}
	}
	return ask.length > 0 ? { ask } : undefined;
}

function isSubCommandDenial(value: AgentHostTerminalAutoApproveRuleValue): boolean {
	if (value === false) {
		return true;
	}
	return typeof value === 'object' && value !== null && value.approve === false && value.matchCommandLine !== true;
}

const AUTO_APPROVE_REGEX_KEY = /^\/.+\/[dgimsuvy]*$/;

function isLiteralCommandKey(command: string): boolean {
	return !AUTO_APPROVE_REGEX_KEY.test(command) && !command.includes('*');
}

function contributeEligibleForAutoApprovalRestriction(value: Record<string, boolean>): IAgentHostManagedSettingsPermissions | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	if (Object.values(value).every(eligible => eligible === true)) {
		return undefined;
	}
	return { disableBypassPermissionsMode: 'disable' };
}

const managedPermissionsSettings: readonly IManagedPermissionsSettingMapping[] = [
	managedPermissionsSetting<boolean>(GLOBAL_AUTO_APPROVE_SETTING_ID, 'policyOnly', value => value === false ? { disableBypassPermissionsMode: 'disable' } : undefined),
	managedPermissionsSetting<Record<string, boolean>>(ELIGIBLE_FOR_AUTO_APPROVAL_SETTING_ID, 'policyOnly', contributeEligibleForAutoApprovalRestriction),
	managedPermissionsSetting<boolean>(TERMINAL_AUTO_APPROVE_ENABLED_SETTING_ID, 'anyGlobal', value => value === false ? { ask: [buildManagedFamilyRule(ManagedRuleFamily.Shell)] } : undefined),
	managedPermissionsCompositeSetting(
		AgentNetworkDomainSettingId.NetworkFilter,
		[AgentNetworkDomainSettingId.AllowedNetworkDomains, AgentNetworkDomainSettingId.DeniedNetworkDomains],
		contributeNetworkDomainRules,
	),
	managedPermissionsSetting<AgentHostTerminalAutoApproveRules>(TERMINAL_AUTO_APPROVE_SETTING_ID, 'anyGlobal', contributeTerminalDenialRules),
];

export const managedPermissionsConfigurationIds = [
	AgentHostMapLegacySettingsToManagedSettingsSettingId,
	...managedPermissionsSettings.flatMap(mapping => [mapping.settingId, ...mapping.additionalSettingIds ?? []]),
];

export function isManagedSettingsPermissions(value: unknown): value is IAgentHostManagedSettingsPermissions {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const permissions = value as Record<string, unknown>;
	if (Object.keys(permissions).some(key => key !== 'disableBypassPermissionsMode' && key !== 'deny' && key !== 'ask')) {
		return false;
	}
	return (permissions.disableBypassPermissionsMode === undefined || permissions.disableBypassPermissionsMode === 'disable')
		&& isStringArrayOrUndefined(permissions.deny)
		&& isStringArrayOrUndefined(permissions.ask);
}

function isStringArrayOrUndefined(value: unknown): boolean {
	return value === undefined || (Array.isArray(value) && value.every(item => typeof item === 'string'));
}

export function resolveManagedSettingsPermissions(configurationService: IConfigurationService): IAgentHostManagedSettingsPermissions {
	if (getGlobalConfigurationValue<boolean>(configurationService, AgentHostMapLegacySettingsToManagedSettingsSettingId) !== true) {
		return {};
	}

	const deny = new Set<string>();
	const ask = new Set<string>();
	let disableBypassPermissionsMode: 'disable' | undefined;
	for (const mapping of managedPermissionsSettings) {
		const contribution = mapping.contribute(configurationService);
		if (!contribution) {
			continue;
		}
		if (contribution.disableBypassPermissionsMode) {
			disableBypassPermissionsMode = contribution.disableBypassPermissionsMode;
		}
		contribution.deny?.forEach(rule => deny.add(rule));
		contribution.ask?.forEach(rule => ask.add(rule));
	}

	const permissions: IAgentHostManagedSettingsPermissions = {};
	if (disableBypassPermissionsMode) {
		permissions.disableBypassPermissionsMode = disableBypassPermissionsMode;
	}
	if (deny.size > 0) {
		permissions.deny = [...deny];
	}
	if (ask.size > 0) {
		permissions.ask = [...ask];
	}
	return permissions;
}
