/**
 * Dardcor Code - Editor Tab Header Context Menu
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { layoutContextMenu, getAnchorFromMouseEvent, IAnchor } from '../../../core/dom/context-menu';
import { EditorInput } from './editor-input';

export type TabContextMenuAction =
	| 'close'
	| 'closeOthers'
	| 'closeSaved'
	| 'togglePin'
	| 'copyPath'
	| 'copyRelativePath'
	| 'splitEditor';

export interface ITabContextMenuEvent {
	readonly action: TabContextMenuAction;
	readonly input: EditorInput;
}

export interface ITabContextMenuOptions {
	readonly isPinned?: boolean;
	readonly hasDirty?: boolean;
	readonly actionHandlers?: Partial<Record<TabContextMenuAction, () => void>>;
}

interface IMenuItemSpec {
	readonly id: TabContextMenuAction;
	readonly label: string;
	readonly enabled?: boolean;
}

interface IMenuSeparatorSpec {
	readonly separator: true;
}

type IMenuSpec = IMenuItemSpec | IMenuSeparatorSpec;

const WIDTH = 220;
const ITEM_HEIGHT = 26;

export class TabContextMenu extends Disposable {
	private _menu: HTMLElement | null = null;
	private _highlightedIndex = -1;

	private readonly _onDidSelectAction = this._register(new Emitter<ITabContextMenuEvent>());
	readonly onDidSelectAction: Event<ITabContextMenuEvent> = this._onDidSelectAction.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	open(input: EditorInput, anchor: HTMLElement | MouseEvent | IAnchor, options: ITabContextMenuOptions = {}): void {
		this.close();
		const anchorInfo = anchor instanceof HTMLElement
			? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom }
			: 'clientX' in anchor ? getAnchorFromMouseEvent(anchor as MouseEvent) : anchor as IAnchor;

		const items = this._buildItems(options);
		const height = items.filter(i => !('separator' in i)).length * ITEM_HEIGHT + items.filter(i => 'separator' in i).length * 9 + 8;
		const layout = layoutContextMenu(anchorInfo, WIDTH, height, window.innerWidth, window.innerHeight);

		const menu = $<HTMLElement>('div', 'dc-tab-context-menu');
		menu.style.cssText = `position:fixed;left:${layout.left}px;top:${layout.top}px;width:${WIDTH}px;max-height:${layout.maxHeight}px;overflow-y:auto;background:#252526;border:1px solid #454545;box-shadow:0 6px 16px rgba(0,0,0,0.4);z-index:2100;padding:4px 0;font-size:12px;color:#cccccc;font-family:Segoe UI, sans-serif;user-select:none;`;
		menu.addEventListener('contextmenu', (e: MouseEvent) => e.preventDefault());
		this._menu = menu;
		document.body.appendChild(menu);

		this._renderItems(menu, items, input, options);

		this._registerOutsideClick(menu);
		this._registerKeyDown(menu, items, input);
	}

	close(): void {
		if (this._menu) {
			this._menu.remove();
			this._menu = null;
		}
		this._highlightedIndex = -1;
	}

	get isOpen(): boolean {
		return this._menu !== null;
	}

	private _buildItems(options: ITabContextMenuOptions): IMenuSpec[] {
		const items: IMenuSpec[] = [
			{ id: 'close', label: 'Close', enabled: options.hasDirty === false },
			{ id: 'closeOthers', label: 'Close Others' },
			{ id: 'closeSaved', label: 'Close Saved' },
			{ separator: true },
			{ id: 'togglePin', label: options.isPinned ? 'Unpin' : 'Pin' },
			{ separator: true },
			{ id: 'copyPath', label: 'Copy Path' },
			{ id: 'copyRelativePath', label: 'Copy Relative Path' },
			{ separator: true },
			{ id: 'splitEditor', label: 'Split Right' },
		];
		return items;
	}

	private _renderItems(menu: HTMLElement, items: IMenuSpec[], input: EditorInput, options: ITabContextMenuOptions): void {
		let visibleIndex = -1;
		for (const item of items) {
			if ('separator' in item) {
				const sep = $<HTMLElement>('div', 'dc-tab-context-menu-separator');
				sep.style.cssText = 'height:1px;background:#3c3c3c;margin:4px 10px;';
				menu.appendChild(sep);
				continue;
			}
			visibleIndex++;
			const row = $<HTMLElement>('div', 'dc-tab-context-menu-item');
			row.dataset['menuIndex'] = `${visibleIndex}`;
			row.style.cssText = 'display:flex;align-items:center;padding:0 12px;height:26px;cursor:pointer;';
			if (item.enabled === false) {
				row.style.color = '#5a5a5a';
				row.style.cursor = 'default';
			}
			row.textContent = item.label;
			row.addEventListener('mousemove', () => {
				this._highlightedIndex = visibleIndex;
				this._highlight(menu);
			});
			row.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				if (item.enabled === false) {
					return;
				}
				const handler = options.actionHandlers?.[item.id];
				handler?.();
				this._onDidSelectAction.fire({ action: item.id, input });
				this.close();
			});
			menu.appendChild(row);
		}
	}

	private _highlight(menu: HTMLElement): void {
		const rows = Array.from(menu.querySelectorAll('.dc-tab-context-menu-item'));
		rows.forEach((row, index) => {
			const el = row as HTMLElement;
			el.style.background = index === this._highlightedIndex ? '#04395e' : 'transparent';
		});
	}

	private _registerOutsideClick(menu: HTMLElement): void {
		const onMouseDown = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				document.removeEventListener('mousedown', onMouseDown);
				this.close();
				this._onDidClose.fire();
			}
		};
		document.addEventListener('mousedown', onMouseDown);
	}

	private _registerKeyDown(menu: HTMLElement, items: IMenuSpec[], input: EditorInput): void {
		const onKeyDown = (e: KeyboardEvent) => {
			const enabled = items.filter((i): i is IMenuItemSpec => !('separator' in i) && i.enabled !== false);
			switch (e.key) {
				case 'ArrowDown':
					e.preventDefault();
					this._highlightedIndex = Math.min(this._highlightedIndex + 1, enabled.length - 1);
					this._highlight(menu);
					break;
				case 'ArrowUp':
					e.preventDefault();
					this._highlightedIndex = Math.max(this._highlightedIndex - 1, 0);
					this._highlight(menu);
					break;
				case 'Enter':
					e.preventDefault();
					this.close();
					break;
				case 'Escape':
					e.preventDefault();
					this.close();
					this._onDidClose.fire();
					document.removeEventListener('keydown', onKeyDown);
					break;
			}
			if (e.key === 'Escape' || e.key === 'Enter') {
				document.removeEventListener('keydown', onKeyDown);
			}
		};
		document.addEventListener('keydown', onKeyDown);
	}

	dispose(): void {
		this.close();
		super.dispose();
	}
}
