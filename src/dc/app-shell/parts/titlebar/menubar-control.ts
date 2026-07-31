/**
 * Dardcor Code - Embedded Titlebar Menu Bar Controller
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode, addDisposableListener } from '../../../core/dom/element';
import { layoutContextMenu } from '../../../core/dom/context-menu';

export interface IMenuItem {
	readonly id: string;
	readonly label: string;
	readonly keybinding?: string;
	readonly enabled?: boolean;
	readonly separator?: boolean;
	readonly children?: IMenuItem[];
}

export interface IMenuEntry {
	readonly id: string;
	readonly title: string;
	readonly children: IMenuItem[];
}

export interface IMenuSelectionEvent {
	readonly entryId: string;
	readonly itemId: string;
}

export class MenubarControl extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _entryButtons = new Map<string, HTMLElement>();
	private _openEntry: IMenuEntry | null = null;
	private _dropdown: HTMLElement | null = null;
	private _highlightedIndex = 0;

	private readonly _onDidSelect = this._register(new Emitter<IMenuSelectionEvent>());
	readonly onDidSelect: Event<IMenuSelectionEvent> = this._onDidSelect.event;

	constructor(
		parent: HTMLElement,
		private _entries: IMenuEntry[]
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-menubar');
		this._container.style.cssText = 'display:flex;align-items:stretch;user-select:none;';
		parent.appendChild(this._container);

		this._register(addDisposableListener(document, 'mousedown', (e: globalThis.Event) => {
			const mouseEvent = e as MouseEvent;
			if (this._openEntry && !this._container.contains(mouseEvent.target as Node) && !this._dropdown?.contains(mouseEvent.target as Node)) {
				this._closeMenu();
			}
		}));
		this._register(addDisposableListener(document, 'keydown', (e: globalThis.Event) => {
			if (this._dropdown) {
				this._onMenuKeyDown(e as KeyboardEvent);
			}
		}));
		this.render();
	}

	get element(): HTMLElement {
		return this._container;
	}

	get openEntry(): IMenuEntry | null {
		return this._openEntry;
	}

	render(): void {
		clearNode(this._container);
		this._entryButtons.clear();
		for (const entry of this._entries) {
			const button = $<HTMLElement>('div', 'dc-menubar-entry');
			button.textContent = entry.title;
			button.style.cssText = 'padding:0 8px;font-size:12px;color:#cccccc;cursor:default;display:flex;align-items:center;line-height:1;';
			button.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				if (this._openEntry === entry) {
					this._closeMenu();
				} else {
					this._openMenu(entry, button);
				}
			});
			this._entryButtons.set(entry.id, button);
			this._container.appendChild(button);
		}
	}

	setEntries(entries: IMenuEntry[]): void {
		this._entries = entries;
		this.render();
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	private _openMenu(entry: IMenuEntry, anchor: HTMLElement): void {
		this._closeMenu();
		this._openEntry = entry;
		const rect = anchor.getBoundingClientRect();
		const anchorInfo = { x: rect.left, y: rect.bottom };
		const height = entry.children.length * 28 + 8;
		const layout = layoutContextMenu(anchorInfo, 240, height, window.innerWidth, window.innerHeight);

		const dropdown = $<HTMLElement>('div', 'dc-menubar-dropdown');
		dropdown.style.cssText = `position:fixed;left:${layout.left}px;top:${layout.top}px;min-width:220px;background:#252526;border:1px solid #454545;box-shadow:0 6px 16px rgba(0,0,0,0.4);z-index:2100;padding:4px 0;font-size:12px;color:#cccccc;`;
		dropdown.tabIndex = 0;
		this._dropdown = dropdown;
		document.body.appendChild(dropdown);

		this._renderItems(entry, dropdown);
		this._highlightedIndex = 0;
		this._highlight(0);
		dropdown.focus();
	}

	private _renderItems(entry: IMenuEntry, dropdown: HTMLElement): void {
		clearNode(dropdown);
		entry.children.forEach((item, index) => {
			if (item.separator) {
				const sep = $<HTMLElement>('div', 'dc-menubar-separator');
				sep.style.cssText = 'height:1px;background:#3c3c3c;margin:4px 8px;';
				dropdown.appendChild(sep);
				return;
			}
			const row = $<HTMLElement>('div', 'dc-menubar-item');
			row.dataset['index'] = `${index}`;
			row.style.cssText = 'display:flex;align-items:center;padding:5px 12px;cursor:default;gap:8px;';
			if (item.enabled === false) {
				row.style.color = '#5a5a5a';
				row.style.cursor = 'default';
			}
			const label = $<HTMLElement>('span', 'dc-menubar-item-label');
			label.textContent = item.label;
			label.style.cssText = 'flex:1;';
			row.appendChild(label);
			if (item.children && item.children.length > 0) {
				const arrow = $<HTMLElement>('span', 'dc-menubar-item-arrow');
				arrow.textContent = '\u25b8';
				arrow.style.cssText = 'color:#858585;font-size:10px;';
				row.appendChild(arrow);
			} else if (item.keybinding) {
				const key = $<HTMLElement>('span', 'dc-menubar-item-key');
				key.textContent = item.keybinding;
				key.style.cssText = 'color:#858585;font-size:11px;';
				row.appendChild(key);
			}
			row.addEventListener('mousemove', () => {
				this._highlightedIndex = index;
				this._highlight(index);
			});
			row.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this._selectItem(entry, item);
			});
			dropdown.appendChild(row);
		});
	}

	private _highlight(index: number): void {
		const rows = Array.from(this._dropdown?.querySelectorAll('.dc-menubar-item') ?? []);
		rows.forEach((row, i) => {
			(row as HTMLElement).style.background = i === index ? '#04395e' : 'transparent';
		});
	}

	private _onMenuKeyDown(e: KeyboardEvent): void {
		const dropdown = this._dropdown;
		if (!dropdown) {
			return;
		}
		const visibleItems = this._openEntry?.children.filter(i => !i.separator) ?? [];
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				this._highlightedIndex = Math.min(this._highlightedIndex + 1, visibleItems.length - 1);
				this._highlight(this._highlightedIndex);
				break;
			case 'ArrowUp':
				e.preventDefault();
				this._highlightedIndex = Math.max(this._highlightedIndex - 1, 0);
				this._highlight(this._highlightedIndex);
				break;
			case 'Enter': {
				e.preventDefault();
				const item = visibleItems[this._highlightedIndex];
				const entry = this._openEntry;
				if (item && entry) {
					this._selectItem(entry, item);
				}
				break;
			}
			case 'Escape':
				e.preventDefault();
				this._closeMenu();
				break;
		}
	}

	private _selectItem(entry: IMenuEntry, item: IMenuItem): void {
		if (item.enabled === false) {
			return;
		}
		if (item.children && item.children.length > 0) {
			return;
		}
		this._onDidSelect.fire({ entryId: entry.id, itemId: item.id });
		this._closeMenu();
	}

	private _closeMenu(): void {
		this._dropdown?.remove();
		this._dropdown = null;
		this._openEntry = null;
	}

	dispose(): void {
		this._closeMenu();
		this._container.remove();
		super.dispose();
	}
}
