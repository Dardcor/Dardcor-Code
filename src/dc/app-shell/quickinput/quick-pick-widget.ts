/**
 * Dardcor Code - Command Palette Fuzzy Search Selection UI Widget
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode } from '../../core/dom/element';
import { QuickPickItem } from './quick-pick-item';
import { ModalDialogHost } from '../dialogs/modal-dialog-host';

export interface IQuickPickOptions {
	title?: string;
	placeholder?: string;
	value?: string;
	items?: QuickPickItem[] | Promise<QuickPickItem[]>;
}

interface IScoredItem {
	readonly item: QuickPickItem;
	readonly score: number;
}

export function scoreFuzzyMatch(query: string, target: string): number {
	const q = query.toLowerCase();
	const t = target.toLowerCase();
	if (!q) {
		return 1;
	}
	if (t.startsWith(q)) {
		return 1 + q.length / Math.max(t.length, 1);
	}
	let qi = 0;
	let score = 0;
	let streak = 0;
	let lastMatch = -2;
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) {
			const wordStart = ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '/' || t[ti - 1] === '.' || t[ti - 1] === '-';
			score += wordStart ? 2 : 1;
			if (ti === lastMatch + 1) {
				streak++;
				score += streak * 0.5;
			} else {
				streak = 0;
			}
			lastMatch = ti;
			qi++;
		}
	}
	if (qi < q.length) {
		return 0;
	}
	return 1 + score / Math.max(t.length, 1);
}

export class QuickPickWidget extends Disposable {
	private _root: HTMLElement | null = null;
	private _input: HTMLInputElement | null = null;
	private _list: HTMLElement | null = null;
	private _countEl: HTMLElement | null = null;
	private _items: QuickPickItem[] = [];
	private _filtered: IScoredItem[] = [];
	private _activeIndex = 0;
	private _query = '';
	private _acceptClosed = false;

	private readonly _onDidAccept = this._register(new Emitter<QuickPickItem>());
	private readonly _onDidCancel = this._register(new Emitter<void>());
	private readonly _onDidChangeValue = this._register(new Emitter<string>());

	readonly onDidAccept: Event<QuickPickItem> = this._onDidAccept.event;
	readonly onDidCancel: Event<void> = this._onDidCancel.event;
	readonly onDidChangeValue: Event<string> = this._onDidChangeValue.event;

	constructor(private readonly _host: ModalDialogHost) {
		super();
	}

	get isOpen(): boolean {
		return this._root !== null;
	}

	async open(options: IQuickPickOptions): Promise<void> {
		this._closeInternal();
		this._query = options.value ?? '';
		this._activeIndex = 0;
		this._acceptClosed = false;

		this._root = $<HTMLElement>('div', 'dc-quick-pick');
		this._root.style.cssText = 'width:480px;max-width:90vw;background:#252526;display:flex;flex-direction:column;font-family:Segoe UI, sans-serif;font-size:13px;color:#cccccc;';

		const searchRow = $<HTMLElement>('div', 'dc-quick-pick-search');
		searchRow.style.cssText = 'display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid #3c3c3c;';
		const icon = $<HTMLElement>('span', 'dc-quick-pick-icon');
		icon.textContent = '\u003e';
		icon.style.cssText = 'color:#cccccc;font-weight:bold;margin-right:8px;';
		this._input = $<HTMLInputElement>('input', 'dc-quick-pick-input');
		this._input.style.cssText = 'flex:1;background:transparent;border:none;outline:none;color:#ffffff;font-size:13px;font-family:Segoe UI, sans-serif;';
		this._input.placeholder = options.placeholder ?? 'Type to search...';
		this._input.value = this._query;
		this._input.spellcheck = false;
		searchRow.appendChild(icon);
		searchRow.appendChild(this._input);
		this._root.appendChild(searchRow);

		this._list = $<HTMLElement>('div', 'dc-quick-pick-list');
		this._list.style.cssText = 'overflow-y:auto;max-height:320px;padding:4px 0;';
		this._root.appendChild(this._list);

		this._countEl = $<HTMLElement>('div', 'dc-quick-pick-count');
		this._countEl.style.cssText = 'padding:4px 10px;font-size:11px;color:#858585;border-top:1px solid #3c3c3c;text-align:right;';
		this._root.appendChild(this._countEl);

		this._registerInputEvents();
		this._host.open(this._root, { title: options.title ?? 'Quick Pick', clickOutsideToClose: true });

		if (options.items) {
			this._items = await options.items;
			this._applyFilter();
		}
		requestAnimationFrame(() => this._input?.focus());
	}

	setItems(items: QuickPickItem[]): void {
		this._items = items;
		this._applyFilter();
	}

	close(): void {
		this._closeInternal();
		this._host.close();
	}

	private _closeInternal(): void {
		if (this._root) {
			this._root.remove();
			this._root = null;
		}
		this._input = null;
		this._list = null;
		this._countEl = null;
	}

	private _registerInputEvents(): void {
		const input = this._input!;
		input.addEventListener('input', () => {
			this._query = input.value;
			this._activeIndex = 0;
			this._applyFilter();
			this._onDidChangeValue.fire(this._query);
		});
		input.addEventListener('keydown', (e: KeyboardEvent) => this._onKeyDown(e));
		this._list!.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
		});
	}

	private _onKeyDown(e: KeyboardEvent): void {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				this._moveActive(1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				this._moveActive(-1);
				break;
			case 'PageDown':
				e.preventDefault();
				this._moveActive(10);
				break;
			case 'PageUp':
				e.preventDefault();
				this._moveActive(-10);
				break;
			case 'Enter': {
				e.preventDefault();
				e.stopPropagation();
				const active = this._filtered[this._activeIndex];
				if (active && !active.item.disabled) {
					this._acceptClosed = true;
					this._onDidAccept.fire(active.item);
				}
				break;
			}
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				this._onDidCancel.fire();
				break;
			case 'Tab':
				e.preventDefault();
				this._moveActive(e.shiftKey ? -1 : 1);
				break;
		}
	}

	private _moveActive(offset: number): void {
		if (this._filtered.length === 0) {
			return;
		}
		let next = this._activeIndex + offset;
		if (next < 0) {
			next = this._filtered.length - 1;
		}
		if (next >= this._filtered.length) {
			next = 0;
		}
		this._activeIndex = next;
		this._renderList();
	}

	private _applyFilter(): void {
		this._filtered = this._items
			.map(item => ({ item, score: scoreFuzzyMatch(this._query, item.getSearchText()) }))
			.filter(entry => entry.score > 0)
			.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
		this._renderList();
	}

	private _renderList(): void {
		if (!this._list) {
			return;
		}
		clearNode(this._list);
		const visible = this._filtered.slice(0, 100);
		visible.forEach((entry, idx) => {
			const row = $<HTMLElement>('div', 'dc-quick-pick-row');
			row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 12px;cursor:pointer;user-select:none;white-space:nowrap;';
			if (entry.item.disabled) {
				row.style.opacity = '0.4';
				row.style.cursor = 'default';
			}
			if (idx === this._activeIndex && !entry.item.disabled) {
				row.style.background = '#04395e';
				row.style.color = '#ffffff';
			}
			const icon = $<HTMLElement>('span', 'dc-quick-pick-row-icon');
			icon.textContent = entry.item.icon ?? '';
			icon.style.cssText = 'width:16px;text-align:center;flex-shrink:0;';
			const labelEl = $<HTMLElement>('span', 'dc-quick-pick-row-label');
			labelEl.textContent = entry.item.label;
			labelEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
			row.appendChild(icon);
			row.appendChild(labelEl);
			if (entry.item.description) {
				const desc = $<HTMLElement>('span', 'dc-quick-pick-row-desc');
				desc.textContent = entry.item.description;
				desc.style.cssText = 'color:#8c8c8c;font-size:12px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;';
				row.appendChild(desc);
			}
			if (entry.item.detail) {
				const detail = $<HTMLElement>('div', 'dc-quick-pick-row-detail');
				detail.textContent = entry.item.detail;
				detail.style.cssText = 'padding:2px 12px 4px;font-size:12px;color:#9d9d9d;';
				this._list!.appendChild(detail);
			}
			row.addEventListener('mousemove', () => {
				if (idx !== this._activeIndex && !entry.item.disabled) {
					this._activeIndex = idx;
					this._renderList();
				}
			});
			row.addEventListener('click', () => {
				if (!entry.item.disabled) {
					this._acceptClosed = true;
					this._onDidAccept.fire(entry.item);
				}
			});
			this._list!.appendChild(row);
		});
		if (this._countEl) {
			this._countEl.textContent = `${this._filtered.length} of ${this._items.length} results`;
		}
	}
}
