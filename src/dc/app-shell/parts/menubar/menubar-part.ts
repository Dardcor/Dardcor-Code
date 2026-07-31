/**
 * Dardcor Code - Top Drop-Down Main Menu Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { MenubarControl, IMenuEntry, IMenuItem, IMenuSelectionEvent } from '../titlebar/menubar-control.js';

export class MenubarPart extends Disposable {
	private readonly _control: MenubarControl;
	private readonly _onDidSelectMenu = this._register(new Emitter<IMenuSelectionEvent>());
	readonly onDidSelectMenu: Event<IMenuSelectionEvent> = this._onDidSelectMenu.event;

	constructor(parent: HTMLElement) {
		super();
		this._control = new MenubarControl(parent, MenubarPart.createDefaultMenus());
		this._register(this._control);
		this._control.onDidSelect(e => this._onDidSelectMenu.fire(e));
	}

	get control(): MenubarControl {
		return this._control;
	}

	setVisible(visible: boolean): void {
		this._control.setVisible(visible);
	}

	setMenus(entries: IMenuEntry[]): void {
		this._control.setEntries(entries);
	}

	static createDefaultMenus(): IMenuEntry[] {
		return [
			{
				id: 'file',
				title: 'File',
				children: [
					{ id: 'file.newFile', label: 'New File', keybinding: 'Ctrl+N' },
					{ id: 'file.newWindow', label: 'New Window', keybinding: 'Ctrl+Shift+N' },
					{ id: 'file.openFile', label: 'Open File...', keybinding: 'Ctrl+O' },
					{ id: 'file.openFolder', label: 'Open Folder...', keybinding: 'Ctrl+K Ctrl+O' },
					{ id: 'sep1', label: '', separator: true },
					{ id: 'file.save', label: 'Save', keybinding: 'Ctrl+S' },
					{ id: 'file.saveAs', label: 'Save As...', keybinding: 'Ctrl+Shift+S' },
					{ id: 'sep2', label: '', separator: true },
					{ id: 'file.closeWindow', label: 'Close Window', keybinding: 'Alt+F4' },
				],
			},
			{
				id: 'edit',
				title: 'Edit',
				children: [
					{ id: 'edit.undo', label: 'Undo', keybinding: 'Ctrl+Z' },
					{ id: 'edit.redo', label: 'Redo', keybinding: 'Ctrl+Y' },
					{ id: 'sep1', label: '', separator: true },
					{ id: 'edit.cut', label: 'Cut', keybinding: 'Ctrl+X' },
					{ id: 'edit.copy', label: 'Copy', keybinding: 'Ctrl+C' },
					{ id: 'edit.paste', label: 'Paste', keybinding: 'Ctrl+V' },
					{ id: 'sep2', label: '', separator: true },
					{ id: 'edit.find', label: 'Find', keybinding: 'Ctrl+F' },
					{ id: 'edit.replace', label: 'Replace', keybinding: 'Ctrl+H' },
				],
			},
			{
				id: 'view',
				title: 'View',
				children: [
					{ id: 'view.commandPalette', label: 'Command Palette...', keybinding: 'Ctrl+Shift+P' },
					{ id: 'view.openView', label: 'Open View', children: [
						{ id: 'view.explorer', label: 'Explorer', keybinding: 'Ctrl+Shift+E' },
						{ id: 'view.search', label: 'Search', keybinding: 'Ctrl+Shift+F' },
					] },
					{ id: 'sep1', label: '', separator: true },
					{ id: 'view.toggleSidebar', label: 'Toggle Side Bar', keybinding: 'Ctrl+B' },
					{ id: 'view.togglePanel', label: 'Toggle Panel', keybinding: 'Ctrl+J' },
					{ id: 'view.toggleStatusbar', label: 'Toggle Status Bar' },
					{ id: 'sep2', label: '', separator: true },
					{ id: 'view.zoomIn', label: 'Zoom In', keybinding: 'Ctrl+=' },
					{ id: 'view.zoomOut', label: 'Zoom Out', keybinding: 'Ctrl+-' },
				],
			},
			{
				id: 'selection',
				title: 'Selection',
				children: [
					{ id: 'selection.selectAll', label: 'Select All', keybinding: 'Ctrl+A' },
					{ id: 'selection.expand', label: 'Expand Selection', keybinding: 'Shift+Alt+\u2192' },
					{ id: 'selection.shrink', label: 'Shrink Selection', keybinding: 'Shift+Alt+\u2190' },
				],
			},
			{
				id: 'help',
				title: 'Help',
				children: [
					{ id: 'help.welcome', label: 'Welcome' },
					{ id: 'help.documentation', label: 'Documentation' },
					{ id: 'sep1', label: '', separator: true },
					{ id: 'help.about', label: 'About Dardcor Code' },
				],
			},
		];
	}
}

export type { IMenuEntry, IMenuItem } from '../titlebar/menubar-control.js';
