/**
 * Dardcor Code - Menu Bar Item Click Dispatcher
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { IMenuEntry, IMenuItem, MenubarPart } from '../menubar/menubar-part';
import { CommandRegistry } from '../../../services/commands/command-service';
import { ServicesAccessor } from '../../../services/instantiation/annotations';

const NOOP_ACCESSOR: ServicesAccessor = {
	get: () => undefined as never,
};

export interface IMenuItemActionOptions {
	readonly entry: IMenuEntry;
	readonly item: IMenuItem;
}

export interface IMenuItemActionEvent {
	readonly entryId: string;
	readonly itemId: string;
	readonly commandId: string | null;
	readonly executed: boolean;
}

const MENU_COMMAND_ALIASES: Record<string, string> = {
	'file.newFile': 'workbench.action.files.newUntitledFile',
	'file.newWindow': 'workbench.action.newWindow',
	'file.openFile': 'workbench.action.files.openFile',
	'file.openFolder': 'workbench.action.openFolder',
	'file.save': 'workbench.action.files.save',
	'file.saveAs': 'workbench.action.files.saveAs',
	'file.closeWindow': 'workbench.action.closeWindow',
	'edit.undo': 'undo',
	'edit.redo': 'redo',
	'edit.cut': 'editor.action.clipboardCutAction',
	'edit.copy': 'editor.action.clipboardCopyAction',
	'edit.paste': 'editor.action.clipboardPasteAction',
	'edit.find': 'actions.find',
	'edit.replace': 'editor.action.startFindReplaceAction',
	'view.commandPalette': 'workbench.action.showCommands',
	'view.toggleSidebar': 'workbench.action.toggleSidebarVisibility',
	'view.togglePanel': 'workbench.action.togglePanel',
	'view.toggleStatusbar': 'workbench.action.toggleStatusbarVisibility',
	'view.zoomIn': 'workbench.action.zoomIn',
	'view.zoomOut': 'workbench.action.zoomOut',
	'selection.selectAll': 'editor.action.selectAll',
};

export class MenuItemAction extends Disposable {
	private readonly _entry: IMenuEntry;
	private readonly _item: IMenuItem;
	private readonly _commandId: string | null;

	private readonly _onDidExecute = this._register(new Emitter<IMenuItemActionEvent>());
	readonly onDidExecute: Event<IMenuItemActionEvent> = this._onDidExecute.event;

	constructor(options: IMenuItemActionOptions) {
		super();
		this._entry = options.entry;
		this._item = options.item;
		this._commandId = this._resolveCommandId(options.item.id);
	}

	get entry(): IMenuEntry {
		return this._entry;
	}

	get item(): IMenuItem {
		return this._item;
	}

	get commandId(): string | null {
		return this._commandId;
	}

	get isEnabled(): boolean {
		return this._item.enabled !== false && !this._isSubmenu();
	}

	canExecute(): boolean {
		if (!this.isEnabled) {
			return false;
		}
		if (this._commandId) {
			return CommandRegistry.getCommand(this._commandId) !== undefined;
		}
		return this._item.id.startsWith('help.') || this._item.id.startsWith('view.') || this._item.id.startsWith('file.') || this._item.id.startsWith('edit.') || this._item.id.startsWith('selection.');
	}

	execute(accessor: ServicesAccessor = NOOP_ACCESSOR): boolean {
		if (this._isSubmenu()) {
			return false;
		}
		const command = this._commandId ? CommandRegistry.getCommand(this._commandId) : undefined;
		if (command) {
			try {
				command.handler(accessor, { entryId: this._entry.id, itemId: this._item.id });
				this._onDidExecute.fire({ entryId: this._entry.id, itemId: this._item.id, commandId: this._commandId, executed: true });
				return true;
			} catch (err) {
				console.error(`Menu item '${this._item.id}' command '${this._commandId}' failed`, err);
			}
		} else {
			this._onDidExecute.fire({ entryId: this._entry.id, itemId: this._item.id, commandId: this._commandId, executed: false });
		}
		return false;
	}

	executeCommand(commandId: string, ...args: any[]): boolean {
		const command = CommandRegistry.getCommand(commandId);
		if (!command) {
			return false;
		}
		try {
			command.handler(NOOP_ACCESSOR, ...args);
			this._onDidExecute.fire({ entryId: this._entry.id, itemId: this._item.id, commandId, executed: true });
			return true;
		} catch (err) {
			console.error(`Menu command '${commandId}' failed`, err);
			return false;
		}
	}

	private _isSubmenu(): boolean {
		return !!this._item.children && this._item.children.length > 0;
	}

	private _resolveCommandId(itemId: string): string | null {
		if (CommandRegistry.getCommand(itemId)) {
			return itemId;
		}
		return MENU_COMMAND_ALIASES[itemId] ?? null;
	}

	dispose(): void {
		super.dispose();
	}
}

export class MenuItemActionDispatcher extends Disposable {
	private readonly _actions = new Map<string, MenuItemAction>();

	private readonly _onDidExecute = this._register(new Emitter<IMenuItemActionEvent>());
	readonly onDidExecute: Event<IMenuItemActionEvent> = this._onDidExecute.event;

	constructor(
		private readonly _menubarPart: MenubarPart | null = null,
		private readonly _commandHandler: ((commandId: string, args: any[]) => void) | null = null
	) {
		super();
		if (this._menubarPart) {
			this._register(this._menubarPart.onDidSelectMenu(e => this.dispatch(e.entryId, e.itemId)));
		}
	}

	registerMenuItem(entry: IMenuEntry, item: IMenuItem): MenuItemAction {
		const action = new MenuItemAction({ entry, item });
		this._register(action);
		this._actions.set(`${entry.id}.${item.id}`, action);
		return action;
	}

	dispatch(entryId: string, itemId: string): boolean {
		const key = `${entryId}.${itemId}`;
		let action = this._actions.get(key);
		if (!action) {
			const entry = this._findEntry(entryId);
			const item = entry?.children.find(i => i.id === itemId);
			if (entry && item) {
				action = this.registerMenuItem(entry, item);
			}
		}
		if (!action) {
			return false;
		}
		const executed = action.execute();
		this._onDidExecute.fire({
			entryId,
			itemId,
			commandId: action.commandId,
			executed,
		});
		return executed;
	}

	dispatchCommand(commandId: string, ...args: any[]): boolean {
		if (this._commandHandler) {
			this._commandHandler(commandId, args);
			return true;
		}
		const command = CommandRegistry.getCommand(commandId);
		if (command) {
			try {
				command.handler(NOOP_ACCESSOR, ...args);
				return true;
			} catch (err) {
				console.error(`Menu command '${commandId}' failed`, err);
			}
		}
		return false;
	}

	private _findEntry(entryId: string): IMenuEntry | undefined {
		for (const entry of MenubarPart.createDefaultMenus()) {
			if (entry.id === entryId) {
				return entry;
			}
		}
		return undefined;
	}

	dispose(): void {
		this._actions.clear();
		super.dispose();
	}
}

export namespace MenuItemActionCommands {
	export function registerAlias(menuItemId: string, commandId: string): { dispose(): void } {
		MENU_COMMAND_ALIASES[menuItemId] = commandId;
		return {
			dispose: () => {
				delete MENU_COMMAND_ALIASES[menuItemId];
			}
		};
	}
}
