/**
 * Dardcor Code - Menu Registry (Task 141)
 * Mirrors: vs/platform/actions/common/actions.ts (MenuRegistry)
 */

import { IDisposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export const enum MenuId {
	CommandPalette = 'CommandPalette',
	EditorContext = 'EditorContext',
	EditorTitle = 'EditorTitle',
	ViewTitle = 'ViewTitle',
	MenubarFileMenu = 'MenubarFileMenu',
	MenubarEditMenu = 'MenubarEditMenu',
	MenubarViewMenu = 'MenubarViewMenu',
	MenubarHelpMenu = 'MenubarHelpMenu',
}

export interface IMenuItem {
	command: {
		id: string;
		title: string;
		category?: string;
		icon?: { id: string };
	};
	group?: string;
	order?: number;
	when?: string;
}

export const IMenuRegistry = Symbol('IMenuRegistry');

export interface IMenuRegistry {
	readonly onDidChangeMenu: Event<MenuId>;
	appendMenuItem(menuId: MenuId, item: IMenuItem): IDisposable;
	getMenuItems(menuId: MenuId): IMenuItem[];
}

export class MenuRegistry implements IMenuRegistry {
	private readonly _items = new Map<MenuId, IMenuItem[]>();
	private readonly _onDidChangeMenu = new Emitter<MenuId>();
	readonly onDidChangeMenu: Event<MenuId> = this._onDidChangeMenu.event;

	appendMenuItem(menuId: MenuId, item: IMenuItem): IDisposable {
		let list = this._items.get(menuId);
		if (!list) {
			list = [];
			this._items.set(menuId, list);
		}
		list.push(item);
		list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		this._onDidChangeMenu.fire(menuId);

		return {
			dispose: () => {
				const idx = list!.indexOf(item);
				if (idx >= 0) {
					list!.splice(idx, 1);
					this._onDidChangeMenu.fire(menuId);
				}
			}
		};
	}

	getMenuItems(menuId: MenuId): IMenuItem[] {
		return [...(this._items.get(menuId) ?? [])];
	}
}

const menuRegistryInstance = new MenuRegistry();

export function getMenuRegistry(): IMenuRegistry {
	return menuRegistryInstance;
}
