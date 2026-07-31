/**
 * Dardcor Code - Core Context Rules (Task 189)
 * Mirrors: vs/platform/contextkey/common/contextkeys.ts standard context keys
 */

export const CoreContextKeys = {
	editorTextFocus: 'editorTextFocus',
	editorHasSelection: 'editorHasSelection',
	editorHasMultipleSelections: 'editorHasMultipleSelections',
	editorReadonly: 'editorReadonly',
	explorerFocus: 'explorerFocus',
	searchViewletFocus: 'searchViewletFocus',
	inDebugMode: 'inDebugMode',
	isMac: 'isMac',
	isLinux: 'isLinux',
	isWindows: 'isWindows',
} as const;

export type CoreContextKeyName = typeof CoreContextKeys[keyof typeof CoreContextKeys];
