/**
 * Dardcor Code - macOS Default Keybindings (Task 188)
 * Mirrors: vs/workbench/services/keybinding/common/macKeybindings.ts
 */

export interface IMacDefaultKeybinding {
	readonly command: string;
	readonly keybinding: string;
}

export const MAC_DEFAULT_KEYBINDINGS: IMacDefaultKeybinding[] = [
	{ command: 'workbench.action.files.save', keybinding: 'cmd+s' },
	{ command: 'workbench.action.files.open', keybinding: 'cmd+o' },
	{ command: 'workbench.action.files.newUntitledFile', keybinding: 'cmd+n' },
	{ command: 'workbench.action.find', keybinding: 'cmd+f' },
	{ command: 'workbench.action.replace', keybinding: 'cmd+alt+f' },
	{ command: 'workbench.action.showCommands', keybinding: 'cmd+shift+p' },
	{ command: 'workbench.action.closeActiveEditor', keybinding: 'cmd+w' },
	{ command: 'editor.action.formatDocument', keybinding: 'alt+shift+f' },
];
