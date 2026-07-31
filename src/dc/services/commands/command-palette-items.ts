/**
 * Dardcor Code - Command Palette Search Index (Task 196)
 * Mirrors: vs/workbench/browser/actions/commandPalette.ts search items
 */

import { getMenuRegistry, MenuId, IMenuItem } from '../actions/menu-registry';

export interface ICommandPaletteItem {
	id: string;
	label: string;
	category?: string;
	when?: string;
}

let _initialized = false;
function ensureInitialized() {
	if (_initialized) return;
	_initialized = true;
	const registry = getMenuRegistry();
	
	const commands = [
		// File
		{ id: 'file.newFile', title: 'New File', category: 'File' },
		{ id: 'file.newWindow', title: 'New Window', category: 'File' },
		{ id: 'file.openFile', title: 'Open File...', category: 'File' },
		{ id: 'file.openFolder', title: 'Open Folder...', category: 'File' },
		{ id: 'file.openRecent', title: 'Open Recent...', category: 'File' },
		{ id: 'file.save', title: 'Save', category: 'File' },
		{ id: 'file.saveAs', title: 'Save As...', category: 'File' },
		{ id: 'file.saveAll', title: 'Save All', category: 'File' },
		{ id: 'file.closeEditor', title: 'Close Editor', category: 'File' },
		{ id: 'file.closeFolder', title: 'Close Folder', category: 'File' },
		{ id: 'file.closeWindow', title: 'Close Window', category: 'File' },
		{ id: 'file.revertFile', title: 'Revert File', category: 'File' },

		// View
		{ id: 'view.openView', title: 'Open View...', category: 'View' },
		{ id: 'workbench.action.showCommands', title: 'Command Palette...', category: 'View' },
		{ id: 'view.explorer', title: 'Explorer', category: 'View' },
		{ id: 'view.search', title: 'Search', category: 'View' },
		{ id: 'view.scm', title: 'Source Control', category: 'View' },
		{ id: 'view.run', title: 'Run', category: 'View' },
		{ id: 'view.extensions', title: 'Extensions', category: 'View' },
		{ id: 'view.output', title: 'Output', category: 'View' },
		{ id: 'view.debugConsole', title: 'Debug Console', category: 'View' },
		{ id: 'view.problems', title: 'Problems', category: 'View' },
		{ id: 'view.terminal', title: 'Terminal', category: 'View' },
		{ id: 'view.timeline', title: 'Timeline', category: 'View' },
		{ id: 'view.outline', title: 'Outline', category: 'View' },
		{ id: 'view.testing', title: 'Testing', category: 'View' },
		{ id: 'view.remote', title: 'Remote', category: 'View' },
		{ id: 'view.chat', title: 'Chat', category: 'View' },
		{ id: 'view.toggleSidebar', title: 'Toggle Side Bar', category: 'View' },
		{ id: 'view.togglePanel', title: 'Toggle Panel', category: 'View' },
		{ id: 'view.toggleStatusBar', title: 'Toggle Status Bar', category: 'View' },
		{ id: 'view.toggleActivityBar', title: 'Toggle Activity Bar', category: 'View' },
		{ id: 'view.toggleMenuBar', title: 'Toggle Menu Bar', category: 'View' },
		{ id: 'view.toggleBreadcrumbs', title: 'Toggle Breadcrumbs', category: 'View' },
		{ id: 'view.toggleStickyScroll', title: 'Toggle Sticky Scroll', category: 'View' },
		{ id: 'view.toggleMinimap', title: 'Toggle Minimap', category: 'View' },
		{ id: 'view.toggleWordWrap', title: 'Toggle Word Wrap', category: 'View' },
		{ id: 'view.toggleZenMode', title: 'Toggle Zen Mode', category: 'View' },
		{ id: 'view.fullScreen', title: 'Full Screen', category: 'View' },
		{ id: 'view.zoomIn', title: 'Zoom In', category: 'View' },
		{ id: 'view.zoomOut', title: 'Zoom Out', category: 'View' },
		{ id: 'view.resetZoom', title: 'Reset Zoom', category: 'View' },

		// Go
		{ id: 'go.back', title: 'Back', category: 'Go' },
		{ id: 'go.forward', title: 'Forward', category: 'Go' },
		{ id: 'go.lastEditLocation', title: 'Last Edit Location', category: 'Go' },
		{ id: 'go.goToFile', title: 'Go to File...', category: 'Go' },
		{ id: 'go.goToSymbol', title: 'Go to Symbol in Workspace...', category: 'Go' },
		{ id: 'go.goToLine', title: 'Go to Line/Column...', category: 'Go' },
		{ id: 'go.goToDefinition', title: 'Go to Definition', category: 'Go' },
		{ id: 'go.goToImplementation', title: 'Go to Implementation', category: 'Go' },
		{ id: 'go.goToTypeDefinition', title: 'Go to Type Definition', category: 'Go' },
		{ id: 'go.goToReferences', title: 'Go to References', category: 'Go' },
		{ id: 'go.nextProblem', title: 'Go to Next Problem', category: 'Go' },
		{ id: 'go.previousProblem', title: 'Go to Previous Problem', category: 'Go' },

		// Edit
		{ id: 'edit.undo', title: 'Undo', category: 'Edit' },
		{ id: 'edit.redo', title: 'Redo', category: 'Edit' },
		{ id: 'edit.cut', title: 'Cut', category: 'Edit' },
		{ id: 'edit.copy', title: 'Copy', category: 'Edit' },
		{ id: 'edit.paste', title: 'Paste', category: 'Edit' },
		{ id: 'edit.find', title: 'Find', category: 'Edit' },
		{ id: 'edit.replace', title: 'Replace', category: 'Edit' },
		{ id: 'edit.findInFiles', title: 'Find in Files', category: 'Edit' },
		{ id: 'edit.replaceInFiles', title: 'Replace in Files', category: 'Edit' },
		{ id: 'edit.selectAll', title: 'Select All', category: 'Edit' },
		{ id: 'edit.toggleLineComment', title: 'Toggle Line Comment', category: 'Edit' },
		{ id: 'edit.toggleBlockComment', title: 'Toggle Block Comment', category: 'Edit' },
		{ id: 'emmet.expandAbbreviation', title: 'Expand Abbreviation', category: 'Emmet' },
		{ id: 'emmet.wrapWithAbbreviation', title: 'Wrap with Abbreviation', category: 'Emmet' },

		// Selection
		{ id: 'selection.selectAll', title: 'Select All', category: 'Selection' },
		{ id: 'selection.expandSelection', title: 'Expand Selection', category: 'Selection' },
		{ id: 'selection.shrinkSelection', title: 'Shrink Selection', category: 'Selection' },
		{ id: 'selection.copyLineUp', title: 'Copy Line Up', category: 'Selection' },
		{ id: 'selection.copyLineDown', title: 'Copy Line Down', category: 'Selection' },
		{ id: 'selection.moveLineUp', title: 'Move Line Up', category: 'Selection' },
		{ id: 'selection.moveLineDown', title: 'Move Line Down', category: 'Selection' },
		{ id: 'selection.duplicateSelection', title: 'Duplicate Selection', category: 'Selection' },
		{ id: 'selection.addCursor', title: 'Add Cursor Above/Below', category: 'Selection' },
		{ id: 'selection.addNextOccurrence', title: 'Add Next Occurrence', category: 'Selection' },
		{ id: 'selection.addPreviousOccurrence', title: 'Add Previous Occurrence', category: 'Selection' },
		{ id: 'selection.selectAllOccurrences', title: 'Select All Occurrences', category: 'Selection' },
		{ id: 'selection.columnSelection', title: 'Column Selection Mode', category: 'Selection' },
		{ id: 'selection.convertCase', title: 'Convert Case', category: 'Selection' },
		{ id: 'selection.splitSelectionIntoLines', title: 'Split Selection into Lines', category: 'Selection' },

		// Run
		{ id: 'run.startDebugging', title: 'Start Debugging', category: 'Run' },
		{ id: 'run.runWithoutDebugging', title: 'Run Without Debugging', category: 'Run' },
		{ id: 'run.stop', title: 'Stop Debugging', category: 'Run' },
		{ id: 'run.restart', title: 'Restart Debugging', category: 'Run' },
		{ id: 'run.stepOver', title: 'Step Over', category: 'Run' },
		{ id: 'run.stepInto', title: 'Step Into', category: 'Run' },
		{ id: 'run.stepOut', title: 'Step Out', category: 'Run' },
		{ id: 'run.continue', title: 'Continue', category: 'Run' },
		{ id: 'run.pause', title: 'Pause', category: 'Run' },
		{ id: 'run.toggleBreakpoint', title: 'Toggle Breakpoint', category: 'Run' },
		{ id: 'run.addFunctionBreakpoint', title: 'Add Function Breakpoint', category: 'Run' },
		{ id: 'run.addConditionalBreakpoint', title: 'Add Conditional Breakpoint', category: 'Run' },
		{ id: 'run.addLogpoint', title: 'Add Logpoint', category: 'Run' },
		{ id: 'run.openConfigurations', title: 'Open Configurations', category: 'Run' },
		{ id: 'run.addConfiguration', title: 'Add Configuration', category: 'Run' },

		// Terminal
		{ id: 'terminal.newTerminal', title: 'New Terminal', category: 'Terminal' },
		{ id: 'terminal.splitTerminal', title: 'Split Terminal', category: 'Terminal' },
		{ id: 'terminal.selectDefaultProfile', title: 'Select Default Profile', category: 'Terminal' },
		{ id: 'terminal.runTask', title: 'Run Task', category: 'Terminal' },
		{ id: 'terminal.runBuildTask', title: 'Run Build Task', category: 'Terminal' },
		{ id: 'terminal.runTestTask', title: 'Run Test Task', category: 'Terminal' },
		{ id: 'terminal.showRunningTasks', title: 'Show Running Tasks', category: 'Terminal' },
		{ id: 'terminal.restartRunningTask', title: 'Restart Running Task', category: 'Terminal' },
		{ id: 'terminal.terminateTask', title: 'Terminate Task', category: 'Terminal' },
		{ id: 'terminal.killTerminal', title: 'Kill Terminal', category: 'Terminal' },
		{ id: 'terminal.copySelection', title: 'Copy Selection', category: 'Terminal' },
		{ id: 'terminal.paste', title: 'Paste', category: 'Terminal' },
		{ id: 'terminal.clear', title: 'Clear', category: 'Terminal' },

		// Help
		{ id: 'help.welcome', title: 'Welcome', category: 'Help' },
		{ id: 'help.showAllCommands', title: 'Show All Commands', category: 'Help' },
		{ id: 'help.documentation', title: 'Documentation', category: 'Help' },
		{ id: 'help.releaseNotes', title: 'Release Notes', category: 'Help' },
		{ id: 'help.keyboardShortcutsReference', title: 'Keyboard Shortcuts Reference', category: 'Help' },
		{ id: 'help.reportIssue', title: 'Report Issue', category: 'Help' },
		{ id: 'help.viewLicense', title: 'View License', category: 'Help' },
		{ id: 'help.about', title: 'About', category: 'Help' },
		{ id: 'help.openProcessExplorer', title: 'Open Process Explorer', category: 'Help' },
		{ id: 'help.checkForUpdates', title: 'Check for Updates', category: 'Help' },

		// Preferences
		{ id: 'preferences.openSettingsUI', title: 'Open Settings (UI)', category: 'Preferences' },
		{ id: 'preferences.openSettingsJSON', title: 'Open Settings (JSON)', category: 'Preferences' },
		{ id: 'preferences.openKeyboardShortcuts', title: 'Open Keyboard Shortcuts', category: 'Preferences' },
		{ id: 'preferences.openKeyboardShortcutsJSON', title: 'Open Keyboard Shortcuts (JSON)', category: 'Preferences' },
		{ id: 'preferences.openColorTheme', title: 'Open Color Theme', category: 'Preferences' },
		{ id: 'preferences.openFileIconTheme', title: 'Open File Icon Theme', category: 'Preferences' },
		{ id: 'preferences.configureDisplayLanguage', title: 'Configure Display Language', category: 'Preferences' },
		{ id: 'preferences.openUserDataSync', title: 'Open User Data Sync', category: 'Preferences' },
		{ id: 'preferences.openProfile', title: 'Open Profile', category: 'Preferences' },

		// Developer
		{ id: 'developer.reloadWindow', title: 'Reload Window', category: 'Developer' },
		{ id: 'developer.forceReloadWindow', title: 'Force Reload Window', category: 'Developer' },
		{ id: 'developer.restartExtensionHost', title: 'Restart Extension Host', category: 'Developer' },
		{ id: 'developer.openProcessExplorer', title: 'Open Process Explorer', category: 'Developer' },
		{ id: 'developer.toggleDeveloperTools', title: 'Toggle Developer Tools', category: 'Developer' },
		{ id: 'developer.openLogsFolder', title: 'Open Logs Folder', category: 'Developer' },
		{ id: 'developer.inspectContextKeys', title: 'Inspect Context Keys', category: 'Developer' },
		{ id: 'developer.showRuntimeExtensions', title: 'Show Runtime Extensions', category: 'Developer' },

		// Workbench
		{ id: 'workbench.openLayout', title: 'Open Layout', category: 'Workbench' },
		{ id: 'workbench.resetLayout', title: 'Reset Layout', category: 'Workbench' },
		{ id: 'workbench.saveLayout', title: 'Save Layout', category: 'Workbench' },
		{ id: 'workbench.gridEditorLayout', title: 'Grid Editor Layout', category: 'Workbench' },
		{ id: 'workbench.moveEditor', title: 'Move Editor', category: 'Workbench' },
		{ id: 'workbench.focusEditorGroup', title: 'Focus Editor Group', category: 'Workbench' },
		{ id: 'workbench.openEditorGroup', title: 'Open Editor Group', category: 'Workbench' },

		// Files
		{ id: 'files.saveAll', title: 'Save All', category: 'Files' },
		{ id: 'files.saveWithoutFormatting', title: 'Save Without Formatting', category: 'Files' },
		{ id: 'files.autoSave', title: 'Auto Save', category: 'Files' },
		{ id: 'files.revert', title: 'Revert', category: 'Files' },
		{ id: 'files.revealInExplorer', title: 'Reveal in Explorer', category: 'Files' },
		{ id: 'files.openInTerminal', title: 'Open in Terminal', category: 'Files' },
		{ id: 'files.copyPath', title: 'Copy Path', category: 'Files' },
		{ id: 'files.copyRelativePath', title: 'Copy Relative Path', category: 'Files' },
		{ id: 'files.openToTheSide', title: 'Open to the Side', category: 'Files' },

		// Search
		{ id: 'search.findInFiles', title: 'Find in Files', category: 'Search' },
		{ id: 'search.replaceInFiles', title: 'Replace in Files', category: 'Search' },
		{ id: 'search.clearSearchHistory', title: 'Clear Search History', category: 'Search' },
		{ id: 'search.toggleSearchDetails', title: 'Toggle Search Details', category: 'Search' },
		{ id: 'search.searchEditor', title: 'Search Editor', category: 'Search' },

		// SCM / Git
		{ id: 'git.clone', title: 'Clone', category: 'Git' },
		{ id: 'git.init', title: 'Initialize Repository', category: 'Git' },
		{ id: 'git.commit', title: 'Commit', category: 'Git' },
		{ id: 'git.pull', title: 'Pull', category: 'Git' },
		{ id: 'git.push', title: 'Push', category: 'Git' },
		{ id: 'git.sync', title: 'Sync', category: 'Git' },
		{ id: 'git.stash', title: 'Stash', category: 'Git' },
		{ id: 'git.branch', title: 'Branch', category: 'Git' },
		{ id: 'git.checkout', title: 'Checkout to...', category: 'Git' },
		{ id: 'git.merge', title: 'Merge Branch...', category: 'Git' },
		{ id: 'git.tag', title: 'Tag', category: 'Git' },
		{ id: 'git.fetch', title: 'Fetch', category: 'Git' },

		// Debug
		{ id: 'debug.start', title: 'Start Debugging', category: 'Debug' },
		{ id: 'debug.attach', title: 'Attach', category: 'Debug' },
		{ id: 'debug.openConfiguration', title: 'Open Configuration', category: 'Debug' },
		{ id: 'debug.selectConfiguration', title: 'Select Configuration', category: 'Debug' },
		{ id: 'debug.toggleAutoAttach', title: 'Toggle Auto Attach', category: 'Debug' },

		// Tasks
		{ id: 'tasks.runBuildTask', title: 'Run Build Task', category: 'Tasks' },
		{ id: 'tasks.runTestTask', title: 'Run Test Task', category: 'Tasks' },
		{ id: 'tasks.runTask', title: 'Run Task', category: 'Tasks' },
		{ id: 'tasks.terminateTask', title: 'Terminate Task', category: 'Tasks' },
		{ id: 'tasks.showRunningTasks', title: 'Show Running Tasks', category: 'Tasks' },

		// Extensions
		{ id: 'extensions.installExtensions', title: 'Install Extensions', category: 'Extensions' },
		{ id: 'extensions.showInstalledExtensions', title: 'Show Installed Extensions', category: 'Extensions' },
		{ id: 'extensions.showOutdatedExtensions', title: 'Show Outdated Extensions', category: 'Extensions' },
		{ id: 'extensions.showRecommendedExtensions', title: 'Show Recommended Extensions', category: 'Extensions' },
		{ id: 'extensions.showMarketplace', title: 'Show Marketplace', category: 'Extensions' },
		{ id: 'extensions.clearSearch', title: 'Clear Search', category: 'Extensions' },

		// Markdown
		{ id: 'markdown.openPreview', title: 'Open Preview', category: 'Markdown' },
		{ id: 'markdown.openPreviewToTheSide', title: 'Open Preview to the Side', category: 'Markdown' },
		{ id: 'markdown.print', title: 'Print', category: 'Markdown' },
		{ id: 'markdown.updateImageSize', title: 'Update Image Size', category: 'Markdown' },

		// Notebook
		{ id: 'notebook.runAll', title: 'Run All', category: 'Notebook' },
		{ id: 'notebook.runCell', title: 'Run Cell', category: 'Notebook' },
		{ id: 'notebook.clearOutputs', title: 'Clear Outputs', category: 'Notebook' },
		{ id: 'notebook.addCell', title: 'Add Cell', category: 'Notebook' },
		{ id: 'notebook.deleteCell', title: 'Delete Cell', category: 'Notebook' },
		{ id: 'notebook.moveCellUp', title: 'Move Cell Up', category: 'Notebook' },
		{ id: 'notebook.moveCellDown', title: 'Move Cell Down', category: 'Notebook' },

		// Emmet (additional)
		{ id: 'emmet.balance', title: 'Balance', category: 'Emmet' },
		{ id: 'emmet.updateImageSize', title: 'Update Image Size', category: 'Emmet' },

		// Settings
		{ id: 'settings.openUserSettings', title: 'Open User Settings', category: 'Settings' },
		{ id: 'settings.openWorkspaceSettings', title: 'Open Workspace Settings', category: 'Settings' },
		{ id: 'settings.openFolderSettings', title: 'Open Folder Settings', category: 'Settings' },
		{ id: 'settings.search', title: 'Search', category: 'Settings' },
		{ id: 'settings.sync', title: 'Sync', category: 'Settings' },

		// Keybindings
		{ id: 'keybindings.open', title: 'Open Keyboard Shortcuts', category: 'Keybindings' },
		{ id: 'keybindings.record', title: 'Record Keystrokes', category: 'Keybindings' },
		{ id: 'keybindings.search', title: 'Search Keybindings', category: 'Keybindings' },

		// Theme
		{ id: 'theme.colorTheme', title: 'Color Theme', category: 'Theme' },
		{ id: 'theme.fileIconTheme', title: 'File Icon Theme', category: 'Theme' },
		{ id: 'theme.productIconTheme', title: 'Product Icon Theme', category: 'Theme' },

		// Timeline
		{ id: 'timeline.open', title: 'Open Timeline', category: 'Timeline' },
		{ id: 'timeline.clear', title: 'Clear Timeline', category: 'Timeline' },

		// Output
		{ id: 'output.show', title: 'Show Output', category: 'Output' },
		{ id: 'output.clear', title: 'Clear Output', category: 'Output' },

		// Problems
		{ id: 'problems.show', title: 'Show Problems', category: 'Problems' },
		{ id: 'problems.clear', title: 'Clear Problems', category: 'Problems' },
		{ id: 'problems.focus', title: 'Focus Problems', category: 'Problems' },

		// Chat
		{ id: 'chat.open', title: 'Open Chat', category: 'Chat' },
		{ id: 'chat.newChat', title: 'New Chat', category: 'Chat' },
		{ id: 'chat.clearChat', title: 'Clear Chat', category: 'Chat' },

		// Remote
		{ id: 'remote.connect', title: 'Connect to Remote', category: 'Remote' },
		{ id: 'remote.disconnect', title: 'Disconnect from Remote', category: 'Remote' },
		{ id: 'remote.show', title: 'Show Remote Menu', category: 'Remote' },

		// Tunnel
		{ id: 'tunnel.forwardPort', title: 'Forward Port', category: 'Tunnel' },
		{ id: 'tunnel.stop', title: 'Stop Tunnel', category: 'Tunnel' },
		{ id: 'tunnel.show', title: 'Show Tunnels', category: 'Tunnel' },

		// Edit Sessions
		{ id: 'editSessions.sync', title: 'Sync Edit Sessions', category: 'Edit Sessions' },
		{ id: 'editSessions.clear', title: 'Clear Edit Sessions', category: 'Edit Sessions' },

		// User Data Sync
		{ id: 'userDataSync.turnOn', title: 'Turn On Sync', category: 'Sync' },
		{ id: 'userDataSync.turnOff', title: 'Turn Off Sync', category: 'Sync' },
		{ id: 'userDataSync.show', title: 'Show Sync', category: 'Sync' },

		// Profile
		{ id: 'profile.create', title: 'Create Profile', category: 'Profile' },
		{ id: 'profile.switch', title: 'Switch Profile', category: 'Profile' },
		{ id: 'profile.delete', title: 'Delete Profile', category: 'Profile' },
		{ id: 'profile.export', title: 'Export Profile', category: 'Profile' },
		{ id: 'profile.import', title: 'Import Profile', category: 'Profile' }
	];

	for (const cmd of commands) {
		registry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: cmd.id,
				title: cmd.title,
				category: cmd.category
			}
		});
	}
}

export function getCommandPaletteItems(): ICommandPaletteItem[] {
	ensureInitialized();
	const items = getMenuRegistry().getMenuItems(MenuId.CommandPalette);
	const results: ICommandPaletteItem[] = [];

	for (const item of items) {
		results.push({
			id: item.command.id,
			label: item.command.title,
			category: item.command.category,
			when: item.when,
		});
	}

	return results;
}

export function searchCommandPalette(query: string): ICommandPaletteItem[] {
	const items = getCommandPaletteItems();
	if (!query.trim()) return items;
	const lower = query.toLowerCase();

	return items.filter(item => {
		const full = `${item.category ? item.category + ': ' : ''}${item.label}`.toLowerCase();
		return full.includes(lower) || item.id.toLowerCase().includes(lower);
	});
}
