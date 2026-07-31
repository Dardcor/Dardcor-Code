/**
 * Dardcor Code - Configuration Target Selector (Task 159)
 * Mirrors: vs/platform/configuration/common/configuration.ts Scope target selector
 */

export const enum ConfigurationScope {
	APPLICATION = 1,
	MACHINE = 2,
	MACHINE_OVERRIDABLE = 3,
	WINDOW = 4,
	RESOURCE = 5,
	LANGUAGE_OVERRIDABLE = 6,
	MACHINE_OVERRIDABLE_BY_LANGUAGE = 7,
}

export interface IConfigurationTargetSelector {
	target: 'user' | 'userLocal' | 'userRemote' | 'workspace' | 'workspaceFolder';
	scope: ConfigurationScope;
}

export function matchesScope(scope: ConfigurationScope, targetScope: ConfigurationScope): boolean {
	if (scope === ConfigurationScope.APPLICATION) {
		return targetScope === ConfigurationScope.APPLICATION;
	}
	return true;
}
