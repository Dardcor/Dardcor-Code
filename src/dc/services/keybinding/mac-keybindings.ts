/**
 * Dardcor Code - macOS Default Keybindings Map (Task 188)
 * Mirrors: vs/workbench/services/keybinding/common/macKeybindings.ts
 * DSL compatible with keybinding-parser.ts (ctrl/shift/alt/option/cmd/meta/win/command prefixes).
 */

export interface IMacDefaultKeybinding {
	readonly command: string;
	readonly keybinding: string;
	readonly when?: string;
}

export const MAC_DEFAULT_KEYBINDINGS: IMacDefaultKeybinding[] = [
	// File
	{ command: 'workbench.action.files.newUntitledFile', keybinding: 'cmd+n' },
	{ command: 'workbench.action.files.open', keybinding: 'cmd+o' },
	{ command: 'workbench.action.files.save', keybinding: 'cmd+s' },
	{ command: 'workbench.action.files.saveAs', keybinding: 'cmd+shift+s' },
	{ command: 'workbench.action.files.closeFile', keybinding: 'cmd+w' },
	{ command: 'workbench.action.closeWindow', keybinding: 'cmd+shift+w' },
	{ command: 'workbench.action.quit', keybinding: 'cmd+q' },
	// Edit
	{ command: 'editor.action.clipboardCopyAction', keybinding: 'cmd+c', when: 'editorTextFocus' },
	{ command: 'editor.action.clipboardPasteAction', keybinding: 'cmd+v', when: 'editorTextFocus' },
	{ command: 'editor.action.clipboardCutAction', keybinding: 'cmd+x', when: 'editorTextFocus' },
	{ command: 'editor.action.selectAll', keybinding: 'cmd+a', when: 'editorTextFocus' },
	{ command: 'undo', keybinding: 'cmd+z', when: 'editorTextFocus' },
	{ command: 'redo', keybinding: 'cmd+shift+z', when: 'editorTextFocus' },
	{ command: 'editor.action.deleteLines', keybinding: 'cmd+shift+k', when: 'editorTextFocus' },
	{ command: 'editor.action.commentLine', keybinding: 'cmd+shift+c', when: 'editorTextFocus' },
	{ command: 'editor.action.toggleTabFocusMode', keybinding: 'ctrl+shift+m', when: 'editorTextFocus' },
	// Navigation
	{ command: 'workbench.action.showCommands', keybinding: 'cmd+shift+p' },
	{ command: 'workbench.action.quickOpen', keybinding: 'cmd+p' },
	{ command: 'workbench.action.gotoSymbol', keybinding: 'cmd+shift+o' },
	{ command: 'workbench.action.gotoLine', keybinding: 'ctrl+g' },
	{ command: 'workbench.action.findInFiles', keybinding: 'cmd+shift+f' },
	{ command: 'editor.action.startFindReplaceAction', keybinding: 'cmd+alt+f', when: 'editorTextFocus' },
	{ command: 'workbench.action.find', keybinding: 'cmd+f', when: 'editorTextFocus' },
	{ command: 'editor.action.nextMatchFindAction', keybinding: 'cmd+g', when: 'editorTextFocus' },
	{ command: 'editor.action.previousMatchFindAction', keybinding: 'cmd+shift+g', when: 'editorTextFocus' },
	{ command: 'workbench.action.navigateBack', keybinding: 'ctrl+-' },
	{ command: 'workbench.action.navigateForward', keybinding: 'ctrl+shift+-' },
	// View & Formatting
	{ command: 'workbench.action.toggleSidebarVisibility', keybinding: 'cmd+b' },
	{ command: 'workbench.action.togglePanel', keybinding: 'ctrl+j' },
	{ command: 'workbench.action.terminal.toggleTerminal', keybinding: 'ctrl+`' },
	{ command: 'workbench.action.reloadWindow', keybinding: 'cmd+r' },
	{ command: 'workbench.action.closeAllEditors', keybinding: 'cmd+k cmd+w' },
	{ command: 'editor.action.formatDocument', keybinding: 'alt+shift+f', when: 'editorTextFocus' },
	{ command: 'editor.action.formatSelection', keybinding: 'cmd+k cmd+f', when: 'editorTextFocus' },
	{ command: 'workbench.action.zoomIn', keybinding: 'cmd+=' },
	{ command: 'workbench.action.zoomOut', keybinding: 'cmd+-' },
];

export function getMacDefaultKeybindings(): IMacDefaultKeybinding[] {
	return MAC_DEFAULT_KEYBINDINGS.map((k) => ({ ...k }));
}
