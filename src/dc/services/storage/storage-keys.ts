/**
 * Dardcor Code - Typed Storage Key Definitions (Task 186)
 * Mirrors: vs/platform/storage/common/storage.ts key definitions
 */

export const StorageKeys = {
	COLOR_THEME: 'dardcor-code.theme.colorTheme',
	ICON_THEME: 'dardcor-code.theme.iconTheme',
	WORKBENCH_LAYOUT: 'dardcor-code.workbench.layoutState',
	RECENTLY_OPENED: 'dardcor-code.history.recentlyOpened',
	TELEMETRY_ID: 'dardcor-code.telemetry.machineId',
	LOCALE_OVERRIDE: 'dardcor-code.locale.override',
	LAST_KNOWN_VERSION: 'dardcor-code.update.lastKnownVersion',
} as const;

export type StorageKeyName = typeof StorageKeys[keyof typeof StorageKeys];
