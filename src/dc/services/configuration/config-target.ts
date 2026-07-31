/**
 * Dardcor Code - Configuration Target Selector (Task 159)
 * Mirrors: vs/platform/configuration/common/configuration.ts (Scope target selector)
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

export type ConfigurationTarget = 'user' | 'userLocal' | 'userRemote' | 'workspace' | 'workspaceFolder';

export interface IConfigurationTargetSelector {
	target: ConfigurationTarget;
	scope: ConfigurationScope;
}

export function getTargetScope(target: ConfigurationTarget): ConfigurationScope {
	switch (target) {
		case 'user':
			return ConfigurationScope.MACHINE_OVERRIDABLE;
		case 'userLocal':
			return ConfigurationScope.MACHINE;
		case 'userRemote':
			return ConfigurationScope.MACHINE_OVERRIDABLE;
		case 'workspace':
			return ConfigurationScope.WINDOW;
		case 'workspaceFolder':
			return ConfigurationScope.RESOURCE;
		default:
			return ConfigurationScope.WINDOW;
	}
}

export function isOverridableScope(scope: ConfigurationScope): boolean {
	return scope === ConfigurationScope.MACHINE_OVERRIDABLE
		|| scope === ConfigurationScope.MACHINE_OVERRIDABLE_BY_LANGUAGE
		|| scope === ConfigurationScope.LANGUAGE_OVERRIDABLE;
}

export function matchesScope(scope: ConfigurationScope, targetScope: ConfigurationScope): boolean {
	if (scope === ConfigurationScope.APPLICATION || scope === ConfigurationScope.MACHINE) {
		return targetScope === scope;
	}
	if (scope === ConfigurationScope.WINDOW) {
		return targetScope === ConfigurationScope.WINDOW || targetScope === ConfigurationScope.RESOURCE;
	}
	if (scope === ConfigurationScope.RESOURCE) {
		return targetScope === ConfigurationScope.RESOURCE;
	}
	return true;
}
