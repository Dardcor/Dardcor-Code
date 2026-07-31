import { app, BrowserWindow, Menu, MenuItemConstructorOptions, dialog, shell } from 'electron';

export interface NativeMenuCallbacks {
	onNewFile?: () => void;
	onOpenFile?: () => void;
	onOpenFolder?: () => void;
	onSave?: () => void;
	onSaveAs?: () => void;
	onCloseWindow?: () => void;
	onExit?: () => void;
	onUndo?: () => void;
	onRedo?: () => void;
	onCut?: () => void;
	onCopy?: () => void;
	onPaste?: () => void;
	onCommandPalette?: () => void;
	onToggleSidebar?: () => void;
	onTogglePanel?: () => void;
	onToggleFullScreen?: () => void;
	onAbout?: () => void;
	onOpenSettings?: () => void;
	onFind?: () => void;
	onReplace?: () => void;
	onZoomIn?: () => void;
	onZoomOut?: () => void;
	onZoomReset?: () => void;
}

export function buildNativeMenu(callbacks: NativeMenuCallbacks = {}): Menu {
	const template: MenuItemConstructorOptions[] = [];

	const fileMenu: MenuItemConstructorOptions = {
		label: 'File',
		submenu: [
			{ label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => callbacks.onNewFile?.() },
			{ label: 'Open File...', accelerator: 'CmdOrCtrl+O', click: () => callbacks.onOpenFile?.() },
			{ label: 'Open Folder...', accelerator: 'Ctrl+K Ctrl+O', click: () => callbacks.onOpenFolder?.() },
			{ type: 'separator' },
			{ label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => callbacks.onSave?.() },
			{ label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => callbacks.onSaveAs?.() },
			{ type: 'separator' },
			{ label: 'Find', accelerator: 'CmdOrCtrl+F', click: () => callbacks.onFind?.() },
			{ label: 'Replace', accelerator: 'CmdOrCtrl+H', click: () => callbacks.onReplace?.() },
			{ type: 'separator' },
			{
				label: 'Close Window',
				accelerator: 'CmdOrCtrl+W',
				click: () => {
					const win = BrowserWindow.getFocusedWindow();
					if (win) {
						callbacks.onCloseWindow?.();
						win.close();
					}
				}
			},
			{ type: 'separator' },
			{ label: 'Exit', accelerator: process.platform === 'darwin' ? undefined : 'Alt+F4', click: () => callbacks.onExit?.() ?? app.quit() }
		]
	};

	const editMenu: MenuItemConstructorOptions = {
		label: 'Edit',
		submenu: [
			{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo', click: () => callbacks.onUndo?.() },
			{ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo', click: () => callbacks.onRedo?.() },
			{ type: 'separator' },
			{ label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut', click: () => callbacks.onCut?.() },
			{ label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy', click: () => callbacks.onCopy?.() },
			{ label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste', click: () => callbacks.onPaste?.() },
			{ label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
		]
	};

	const viewMenu: MenuItemConstructorOptions = {
		label: 'View',
		submenu: [
			{ label: 'Command Palette...', accelerator: 'CmdOrCtrl+Shift+P', click: () => callbacks.onCommandPalette?.() },
			{ type: 'separator' },
			{ label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => callbacks.onToggleSidebar?.() },
			{ label: 'Toggle Panel', accelerator: 'CmdOrCtrl+J', click: () => callbacks.onTogglePanel?.() },
			{ type: 'separator' },
			{ label: 'Zoom In', accelerator: 'CmdOrCtrl+=', role: 'zoomIn', click: () => callbacks.onZoomIn?.() },
			{ label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', role: 'zoomOut', click: () => callbacks.onZoomOut?.() },
			{ label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom', click: () => callbacks.onZoomReset?.() },
			{ type: 'separator' },
			{ label: 'Toggle Full Screen', accelerator: 'F11', role: 'togglefullscreen', click: () => callbacks.onToggleFullScreen?.() },
			{ label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' }
		]
	};

	const selectionMenu: MenuItemConstructorOptions = {
		label: 'Selection',
		submenu: [
			{ label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
			{ label: 'Expand Selection', accelerator: 'CmdOrCtrl+Shift+Right', enabled: false },
			{ label: 'Shrink Selection', accelerator: 'CmdOrCtrl+Shift+Left', enabled: false },
			{ type: 'separator' },
			{ label: 'Copy Line Up', accelerator: 'CmdOrCtrl+Shift+Alt+Up', enabled: false },
			{ label: 'Copy Line Down', accelerator: 'CmdOrCtrl+Shift+Alt+Down', enabled: false },
			{ label: 'Move Line Up', accelerator: 'Alt+Up', enabled: false },
			{ label: 'Move Line Down', accelerator: 'Alt+Down', enabled: false }
		]
	};

	const helpMenu: MenuItemConstructorOptions = {
		label: 'Help',
		role: 'help',
		submenu: [
			{
				label: 'About Dardcor Code',
				click: () => callbacks.onAbout?.() ?? dialog.showMessageBox({
					type: 'info',
					title: 'About',
					message: 'Dardcor Code',
					detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nChromium ${process.versions.chrome}\nNode ${process.versions.node}`,
					buttons: ['OK']
				})
			},
			{ type: 'separator' },
			{
				label: 'Open Settings',
				click: () => callbacks.onOpenSettings?.()
			},
			{
				label: 'Documentation',
				click: () => shell.openExternal('https://github.com/anomalyco/opencode/issues')
			},
			{ label: 'Report Issue...', click: () => shell.openExternal('https://github.com/anomalyco/opencode/issues') }
		]
	};

	template.push(fileMenu, editMenu, viewMenu, selectionMenu, helpMenu);
	return Menu.buildFromTemplate(template);
}

export function installNativeMenu(callbacks: NativeMenuCallbacks = {}): Menu {
	const menu = buildNativeMenu(callbacks);
	Menu.setApplicationMenu(menu);
	return menu;
}

export function buildDefaultMenu(): Menu {
	return buildNativeMenu();
}

export function installDefaultMenu(): Menu {
	return installNativeMenu();
}

export function getApplicationMenu(): Menu | null {
	return Menu.getApplicationMenu();
}

export function resetApplicationMenu(): void {
	Menu.setApplicationMenu(null);
}
