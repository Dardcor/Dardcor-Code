/**
 * Dardcor Code - Quick Navigation Key Combo Holding Mode (Ctrl+Tab List)
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';

export interface IQuickNavigateItem {
	readonly key: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: string;
	readonly group?: string;
}

export interface IQuickNavigateAcceptEvent {
	readonly item: IQuickNavigateItem;
	readonly index: number;
}

export class QuickNavigateKey extends Disposable {
	private readonly _overlay: HTMLElement;
	private readonly _list: HTMLElement;
	private _items: IQuickNavigateItem[] = [];
	private _activeIndex = 0;
	private _isActive = false;
	private _ctrlHeld = false;
	private _acceptOnRelease = true;
	private _keydownListener: ((e: KeyboardEvent) => void) | null = null;
	private _keyupListener: ((e: KeyboardEvent) => void) | null = null;

	private readonly _onDidAccept = this._register(new Emitter<IQuickNavigateAcceptEvent>());
	readonly onDidAccept: Event<IQuickNavigateAcceptEvent> = this._onDidAccept.event;

	private readonly _onDidCancel = this._register(new Emitter<void>());
	readonly onDidCancel: Event<void> = this._onDidCancel.event;

	constructor() {
		super();
		this._overlay = $<HTMLElement>('div', 'dc-quick-navigate');
		this._overlay.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);width:480px;max-width:90vw;background:#252526;border:1px solid #454545;box-shadow:0 8px 24px rgba(0,0,0,0.5);z-index:2300;display:none;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;';
		this._list = $<HTMLElement>('div', 'dc-quick-navigate-list');
		this._list.style.cssText = 'max-height:300px;overflow-y:auto;padding:4px 0;';
		this._overlay.appendChild(this._list);
		document.body.appendChild(this._overlay);
	}

	get isActive(): boolean {
		return this._isActive;
	}

	get activeIndex(): number {
		return this._activeIndex;
	}

	get activeItem(): IQuickNavigateItem | null {
		return this._items[this._activeIndex] ?? null;
	}

	start(items: IQuickNavigateItem[], initialKey?: string): void {
		this.cancel();
		this._items = items;
		const initialIndex = initialKey ? items.findIndex(i => i.key === initialKey) : -1;
		this._activeIndex = Math.max(0, initialIndex);
		this._isActive = true;
		this._render();

		this._keydownListener = (e: KeyboardEvent) => {
			if (!this._isActive) {
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				this.cancel();
				return;
			}
			if (e.key === 'Control') {
				this._ctrlHeld = true;
				return;
			}
			if (e.key === 'Tab') {
				e.preventDefault();
				e.stopPropagation();
				if (this._items.length === 0) {
					return;
				}
				if (e.shiftKey) {
					this._activeIndex = (this._activeIndex - 1 + this._items.length) % this._items.length;
				} else {
					this._activeIndex = (this._activeIndex + 1) % this._items.length;
				}
				this._render();
			}
		};
		this._keyupListener = (e: KeyboardEvent) => {
			if (!this._isActive) {
				return;
			}
			if (e.key === 'Control') {
				this._ctrlHeld = false;
				if (this._acceptOnRelease) {
					this.accept();
				}
			}
		};
		window.addEventListener('keydown', this._keydownListener, true);
		window.addEventListener('keyup', this._keyupListener, true);
	}

	accept(): void {
		if (!this._isActive) {
			return;
		}
		const item = this._items[this._activeIndex];
		if (!item) {
			this.cancel();
			return;
		}
		this._teardownListeners();
		this._isActive = false;
		this._overlay.style.display = 'none';
		clearNode(this._list);
		this._onDidAccept.fire({ item, index: this._activeIndex });
	}

	cancel(): void {
		if (!this._isActive) {
			return;
		}
		this._teardownListeners();
		this._isActive = false;
		this._overlay.style.display = 'none';
		clearNode(this._list);
		this._onDidCancel.fire();
	}

	setAcceptOnRelease(accept: boolean): void {
		this._acceptOnRelease = accept;
	}

	private _teardownListeners(): void {
		if (this._keydownListener) {
			window.removeEventListener('keydown', this._keydownListener, true);
			this._keydownListener = null;
		}
		if (this._keyupListener) {
			window.removeEventListener('keyup', this._keyupListener, true);
			this._keyupListener = null;
		}
	}

	private _render(): void {
		clearNode(this._list);
		this._overlay.style.display = 'block';
		this._items.forEach((item, index) => {
			const row = $<HTMLElement>('div', 'dc-quick-navigate-item');
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;white-space:nowrap;';
			if (index === this._activeIndex) {
				row.style.background = '#04395e';
				row.style.color = '#ffffff';
			}
			const icon = $<HTMLElement>('span', 'dc-quick-navigate-item-icon');
			icon.textContent = item.icon ?? '';
			icon.style.cssText = 'width:16px;text-align:center;flex-shrink:0;';
			const label = $<HTMLElement>('span', 'dc-quick-navigate-item-label');
			label.textContent = item.label;
			label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
			row.appendChild(icon);
			row.appendChild(label);
			if (item.description) {
				const desc = $<HTMLElement>('span', 'dc-quick-navigate-item-desc');
				desc.textContent = item.description;
				desc.style.cssText = 'color:#8c8c8c;margin-left:auto;overflow:hidden;text-overflow:ellipsis;';
				row.appendChild(desc);
			}
			row.addEventListener('mousemove', () => {
				if (index !== this._activeIndex) {
					this._activeIndex = index;
					this._render();
				}
			});
			row.addEventListener('click', () => {
				this._activeIndex = index;
				this.accept();
			});
			this._list.appendChild(row);
		});
		const activeRow = this._list.children[this._activeIndex] as HTMLElement | undefined;
		activeRow?.scrollIntoView({ block: 'nearest' });
	}

	dispose(): void {
		this.cancel();
		this._overlay.remove();
		super.dispose();
	}
}
