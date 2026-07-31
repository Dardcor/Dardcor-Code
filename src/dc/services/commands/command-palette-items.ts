/**
 * Dardcor Code - Command Palette Search Index (Task 196)
 * Mirrors: vs/workbench/browser/actions/commandPalette.ts search items
 */

import { getMenuRegistry, MenuId, IMenuItem } from '../actions/menu-registry.js';

export interface ICommandPaletteItem {
	id: string;
	label: string;
	category?: string;
	when?: string;
}

export function getCommandPaletteItems(): ICommandPaletteItem[] {
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
