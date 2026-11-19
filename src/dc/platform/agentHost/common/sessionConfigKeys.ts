/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum SessionConfigKey {
	AutoApprove = 'autoApprove',
	Permissions = 'permissions',
	Isolation = 'isolation',
	Branch = 'branch',
	Mode = 'mode',
	WorktreeBranchPrefix = 'worktreeBranchPrefix',
	WorktreeIncludeFiles = 'worktreeIncludeFiles',
	WorktreeBranchTrack = 'worktreeBranchTrack',
	WorktreeCreateNewBranch = 'worktreeCreateNewBranch',
	AgentMerge = 'agentMerge',
	AgentMergeController = 'agentMerge.controller',
	ShellInitScripts = 'shellInitScripts',
}

export const KNOWN_AUTO_APPROVE_VALUES: ReadonlySet<string> = new Set(['default', 'assisted', 'autoApprove', 'autopilot']);

export const KNOWN_MODE_VALUES: ReadonlySet<string> = new Set(['interactive', 'plan', 'autopilot']);

export function omitTransientSessionConfigValues<T>(values: Record<string, T>): Record<string, T> {
	const result = { ...values };
	delete result[SessionConfigKey.ShellInitScripts];
	return result;
}

const automationDefinitionOwnedConfigKeys = [
	SessionConfigKey.Permissions,
	SessionConfigKey.Isolation,
	SessionConfigKey.Branch,
	SessionConfigKey.WorktreeBranchPrefix,
	SessionConfigKey.WorktreeIncludeFiles,
	SessionConfigKey.WorktreeBranchTrack,
	SessionConfigKey.WorktreeCreateNewBranch,
	SessionConfigKey.AgentMerge,
	SessionConfigKey.AgentMergeController,
] as const;

export function omitAutomationSessionTemplateConfigValues<T>(values: Record<string, T>): Record<string, T> {
	const result = omitTransientSessionConfigValues(values);
	for (const key of automationDefinitionOwnedConfigKeys) {
		delete result[key];
	}
	return result;
}

export function pickAutomationDefinitionOwnedConfigValues<T>(values: Readonly<Record<string, T>> | undefined): Record<string, T> {
	const result: Record<string, T> = {};
	if (!values) {
		return result;
	}
	for (const key of automationDefinitionOwnedConfigKeys) {
		if (Object.hasOwn(values, key)) {
			result[key] = values[key];
		}
	}
	return result;
}
