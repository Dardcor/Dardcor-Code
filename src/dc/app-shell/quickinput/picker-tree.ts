/**
 * Dardcor Code - Grouped Sections Inside Quick Pick Menu List
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode } from '../../core/dom/element';
import { QuickPickItem } from './quick-pick-item';

export interface IPickerTreeGroup {
	readonly id: string;
	readonly label?: string;
	items: QuickPickItem[];
}

export interface IPickerTreeOptions {
	readonly collapsibleGroups?: boolean;
	readonly showGroupHeaders?: boolean;
}

export interface IPickerTreeSelectEvent {
	readonly item: QuickPickItem;
	readonly groupId: string;
	readonly index: number;
}

interface IFlatEntry {
	readonly item: QuickPickItem;
	readonly group: IPickerTreeGroup;
	readonly globalIndex: number;
}

export class PickerTree extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _groups: IPickerTreeGroup[] = [];
	private readonly _flatEntries: IFlatEntry[] = [];
	private readonly _collapsed = new Set<string>();
	private _activeIndex = 0;
	private _activeGroupId: string | null = null;
	private readonly _options: IPickerTreeOptions;

	private readonly _onDidSelectItem = this._register(new Emitter<IPickerTreeSelectEvent>());
	readonly onDidSelectItem: Event<IPickerTreeSelectEvent> = this._onDidSelectItem.event;

	private readonly _onDidToggleGroup = this._register(new Emitter<{ id: string; collapsed: boolean }>());
	readonly onDidToggleGroup: Event<{ id: string; collapsed: boolean }> = this._onDidToggleGroup.event;

	constructor(
		parent: HTMLElement,
		options: IPickerTreeOptions = {}
	) {
		super();
		this._options = {
			collapsibleGroups: options.collapsibleGroups ?? false,
			showGroupHeaders: options.showGroupHeaders ?? true,
		};
		this._container = $<HTMLElement>('div', 'dc-picker-tree');
		this._container.style.cssText = 'overflow-y:auto;flex:1;padding:4px 0;';
		this._container.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
		});
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get groups(): IPickerTreeGroup[] {
		return this._groups;
	}

	get activeItem(): QuickPickItem | null {
		return this._flatEntries[this._activeIndex]?.item ?? null;
	}

	get activeIndex(): number {
		return this._activeIndex;
	}

	getItemCount(): number {
		return this._flatEntries.length;
	}

	setGroups(groups: IPickerTreeGroup[], activeGroupId: string | null = null): void {
		this._groups.length = 0;
		this._groups.push(...groups);
		this._activeGroupId = activeGroupId;
		this._rebuildFlat();
		this._activeIndex = 0;
		this._render();
	}

	addGroup(group: IPickerTreeGroup): void {
		this._groups.push(group);
		this._rebuildFlat();
		this._render();
	}

	setItems(items: QuickPickItem[], groupId = 'default'): void {
		let group = this._groups.find(g => g.id === groupId);
		if (!group) {
			group = { id: groupId, items: [] };
			this._groups.push(group);
		}
		group.items = items;
		this._rebuildFlat();
		this._activeIndex = 0;
		this._render();
	}

	isGroupCollapsed(id: string): boolean {
		return this._collapsed.has(id);
	}

	toggleGroup(id: string): void {
		if (this._collapsed.has(id)) {
			this._collapsed.delete(id);
		} else {
			this._collapsed.add(id);
		}
		this._rebuildFlat();
		this._render();
		this._onDidToggleGroup.fire({ id, collapsed: this._collapsed.has(id) });
	}

	selectNext(): void {
		if (this._flatEntries.length === 0) {
			return;
		}
		this._activeIndex = (this._activeIndex + 1) % this._flatEntries.length;
		this._render();
		this._scrollActiveIntoView();
	}

	selectPrevious(): void {
		if (this._flatEntries.length === 0) {
			return;
		}
		this._activeIndex = (this._activeIndex - 1 + this._flatEntries.length) % this._flatEntries.length;
		this._render();
		this._scrollActiveIntoView();
	}

	setActiveIndex(index: number): void {
		if (index < 0 || index >= this._flatEntries.length) {
			return;
		}
		this._activeIndex = index;
		this._render();
		this._scrollActiveIntoView();
	}

	acceptActive(): void {
		const entry = this._flatEntries[this._activeIndex];
		if (entry && !entry.item.disabled) {
			this._onDidSelectItem.fire({ item: entry.item, groupId: entry.group.id, index: this._activeIndex });
		}
	}

	clear(): void {
		this._groups.length = 0;
		this._flatEntries.length = 0;
		this._collapsed.clear();
		this._activeIndex = 0;
		clearNode(this._container);
	}

	private _rebuildFlat(): void {
		this._flatEntries.length = 0;
		for (const group of this._groups) {
			if (this._collapsed.has(group.id)) {
				continue;
			}
			for (const item of group.items) {
				this._flatEntries.push({ item, group, globalIndex: this._flatEntries.length });
			}
		}
		if (this._activeIndex >= this._flatEntries.length) {
			this._activeIndex = Math.max(0, this._flatEntries.length - 1);
		}
	}

	private _render(): void {
		clearNode(this._container);
		if (this._flatEntries.length === 0 && this._groups.length === 0) {
			const empty = $<HTMLElement>('div', 'dc-picker-tree-empty');
			empty.textContent = 'No items';
			empty.style.cssText = 'padding:16px;text-align:center;color:#858585;font-size:12px;';
			this._container.appendChild(empty);
			return;
		}
		const showHeaders = this._options.showGroupHeaders !== false && this._groups.length > 1;
		for (const group of this._groups) {
			if (this._collapsed.has(group.id)) {
				if (showHeaders) {
					this._appendGroupHeader(group, true);
				}
				continue;
			}
			if (showHeaders) {
				this._appendGroupHeader(group, false);
			}
			for (const item of group.items) {
				this._appendItemRow(item, group);
			}
		}
	}

	private _appendGroupHeader(group: IPickerTreeGroup, collapsed: boolean): void {
		const header = $<HTMLElement>('div', 'dc-picker-tree-group');
		header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 12px 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#bbbbbb;background:#252526;cursor:pointer;user-select:none;';
		const chevron = $<HTMLElement>('span', 'dc-picker-tree-group-chevron');
		chevron.textContent = collapsed ? '\u25b8' : '\u25be';
		chevron.style.cssText = 'width:10px;font-size:9px;color:#858585;';
		const label = $<HTMLElement>('span', 'dc-picker-tree-group-label');
		label.textContent = group.label ?? group.id;
		label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		header.appendChild(chevron);
		header.appendChild(label);
		if (this._options.collapsibleGroups !== false) {
			header.addEventListener('click', () => this.toggleGroup(group.id));
		} else {
			chevron.style.visibility = 'hidden';
		}
		this._container.appendChild(header);
	}

	private _appendItemRow(item: QuickPickItem, group: IPickerTreeGroup): void {
		const entry = this._flatEntries.find(e => e.item === item);
		if (!entry) {
			return;
		}
		const index = entry.globalIndex;
		const row = $<HTMLElement>('div', 'dc-picker-tree-item');
		row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;user-select:none;white-space:nowrap;';
		if (item.disabled) {
			row.style.opacity = '0.4';
			row.style.cursor = 'default';
		}
		if (index === this._activeIndex && !item.disabled) {
			row.style.background = '#04395e';
			row.style.color = '#ffffff';
		}
		const icon = $<HTMLElement>('span', 'dc-picker-tree-item-icon');
		icon.textContent = item.icon ?? '';
		icon.style.cssText = 'width:16px;text-align:center;flex-shrink:0;';
		const labelEl = $<HTMLElement>('span', 'dc-picker-tree-item-label');
		labelEl.textContent = item.label;
		labelEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
		row.appendChild(icon);
		row.appendChild(labelEl);
		if (item.description) {
			const desc = $<HTMLElement>('span', 'dc-picker-tree-item-desc');
			desc.textContent = item.description;
			desc.style.cssText = 'color:#8c8c8c;font-size:12px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;';
			row.appendChild(desc);
		}
		row.addEventListener('mousemove', () => {
			if (index !== this._activeIndex && !item.disabled) {
				this._activeIndex = index;
				this._render();
			}
		});
		row.addEventListener('click', () => {
			if (!item.disabled) {
				this._activeIndex = index;
				this._onDidSelectItem.fire({ item, groupId: group.id, index });
			}
		});
		this._container.appendChild(row);
	}

	private _scrollActiveIntoView(): void {
		const rows = this._container.querySelectorAll('.dc-picker-tree-item');
		const row = rows[this._activeIndex] as HTMLElement | undefined;
		row?.scrollIntoView({ block: 'nearest' });
	}

	dispose(): void {
		this.clear();
		this._container.remove();
		super.dispose();
	}
}
