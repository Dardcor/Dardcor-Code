/**
 * Dardcor Code - Hidden Overflow Tab Drop-Down Selector
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $, clearNode } from '../../../core/dom/element.js';

export interface IOverflowTab {
	readonly key: string;
	readonly label: string;
	readonly icon?: string;
	readonly active?: boolean;
	readonly dirty?: boolean;
	readonly pinned?: boolean;
}

export class EditorOverflowTabs extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _button: HTMLElement;
	private _dropdown: HTMLElement | null = null;
	private _tabs: IOverflowTab[] = [];
	private _activeKey: string | null = null;
	private _visibleCount = 0;

	private readonly _onDidSelectTab = this._register(new Emitter<string>());
	readonly onDidSelectTab: Event<string> = this._onDidSelectTab.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-overflow-tabs');
		this._container.style.cssText = 'display:flex;align-items:center;flex-shrink:0;';

		this._button = $<HTMLElement>('span', 'dc-editor-overflow-button');
		this._button.textContent = '\u22ef';
		this._button.title = 'More Editors...';
		this._button.style.cssText = 'cursor:pointer;color:#858585;font-size:14px;padding:2px 6px;border-radius:3px;display:none;';
		this._button.addEventListener('mouseenter', () => {
			this._button.style.background = '#3c3c3c';
		});
		this._button.addEventListener('mouseleave', () => {
			this._button.style.background = 'transparent';
		});
		this._button.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			if (this._dropdown) {
				this.close();
			} else {
				this.open();
			}
		});

		this._container.appendChild(this._button);
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get isOpen(): boolean {
		return this._dropdown !== null;
	}

	get overflowCount(): number {
		return Math.max(0, this._tabs.length - this._visibleCount);
	}

	setTabs(tabs: IOverflowTab[]): void {
		this._tabs = tabs;
		this._update();
	}

	setActiveKey(activeKey: string | null): void {
		this._activeKey = activeKey;
		this._renderDropdown();
	}

	setVisibleCount(visibleCount: number): void {
		this._visibleCount = visibleCount;
		this._update();
	}

	setHasOverflow(hasOverflow: boolean): void {
		this._button.style.display = hasOverflow ? 'block' : 'none';
		if (!hasOverflow) {
			this.close();
		}
	}

	open(): void {
		if (this._dropdown) {
			return;
		}
		const rect = this._button.getBoundingClientRect();
		const dropdown = $<HTMLElement>('div', 'dc-editor-overflow-dropdown');
		const itemCount = this._overflowTabs().length;
		const height = Math.min(itemCount * 26 + 8, 280);
		dropdown.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${Math.max(8, window.innerWidth - rect.right)}px;min-width:200px;max-height:${height}px;overflow-y:auto;background:#252526;border:1px solid #454545;box-shadow:0 6px 16px rgba(0,0,0,0.4);z-index:2200;padding:4px 0;font-size:12px;color:#cccccc;font-family:Segoe UI, sans-serif;user-select:none;`;
		this._dropdown = dropdown;
		document.body.appendChild(dropdown);
		this._renderDropdown();

		const onMouseDown = (e: MouseEvent) => {
			if (!dropdown.contains(e.target as Node) && !this._button.contains(e.target as Node)) {
				document.removeEventListener('mousedown', onMouseDown);
				this.close();
			}
		};
		document.addEventListener('mousedown', onMouseDown);
	}

	close(): void {
		if (this._dropdown) {
			this._dropdown.remove();
			this._dropdown = null;
			this._onDidClose.fire();
		}
	}

	private _overflowTabs(): IOverflowTab[] {
		return this._tabs.slice(this._visibleCount);
	}

	private _update(): void {
		this._button.style.display = this.overflowCount > 0 ? 'block' : 'none';
		if (this._dropdown) {
			this._renderDropdown();
		}
	}

	private _renderDropdown(): void {
		if (!this._dropdown) {
			return;
		}
		clearNode(this._dropdown);
		const overflowTabs = this._overflowTabs();
		if (overflowTabs.length === 0) {
			this._dropdown.style.display = 'none';
			return;
		}
		this._dropdown.style.display = 'block';
		for (const tab of overflowTabs) {
			const row = $<HTMLElement>('div', 'dc-editor-overflow-item');
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:0 12px;height:26px;cursor:pointer;white-space:nowrap;';
			if (tab.active) {
				row.style.background = '#04395e';
			}
			const icon = $<HTMLElement>('span', 'dc-editor-overflow-item-icon');
			icon.textContent = tab.icon ?? (tab.pinned ? '\u2731' : '');
			icon.style.cssText = 'width:14px;text-align:center;flex-shrink:0;';
			const label = $<HTMLElement>('span', 'dc-editor-overflow-item-label');
			label.textContent = tab.label;
			label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;';
			row.appendChild(icon);
			row.appendChild(label);
			if (tab.active) {
				const check = $<HTMLElement>('span', 'dc-editor-overflow-item-check');
				check.textContent = '\u2713';
				check.style.cssText = 'flex-shrink:0;color:#ffffff;';
				row.appendChild(check);
			}
			row.addEventListener('mouseenter', () => {
				if (!tab.active) {
					row.style.background = '#2d2d2d';
				}
			});
			row.addEventListener('mouseleave', () => {
				if (!tab.active) {
					row.style.background = 'transparent';
				}
			});
			row.addEventListener('click', () => {
				this._onDidSelectTab.fire(tab.key);
				this.close();
			});
			this._dropdown.appendChild(row);
		}
	}

	dispose(): void {
		this.close();
		this._container.remove();
		super.dispose();
	}
}
