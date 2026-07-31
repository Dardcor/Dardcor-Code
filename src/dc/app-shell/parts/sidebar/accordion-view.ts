/**
 * Dardcor Code - Collapsible Section Accordion Header & Content View
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';

export interface IAccordionItemOptions {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly content: HTMLElement;
	readonly expanded?: boolean;
	readonly allowMultiple?: boolean;
}

export interface IAccordionChangeEvent {
	readonly id: string;
	readonly expanded: boolean;
}

export class AccordionItem extends Disposable {
	private readonly _wrapper: HTMLElement;
	private readonly _header: HTMLElement;
	private readonly _chevron: HTMLElement;
	private readonly _title: HTMLElement;
	private readonly _body: HTMLElement;
	private readonly _actions: HTMLElement;
	private _expanded: boolean;
	private _allowMultiple: boolean;

	private readonly _onDidToggle = this._register(new Emitter<IAccordionChangeEvent>());
	readonly onDidToggle: Event<IAccordionChangeEvent> = this._onDidToggle.event;

	constructor(
		private readonly _options: IAccordionItemOptions,
		private readonly _parent: AccordionView
	) {
		super();
		this._expanded = _options.expanded ?? true;
		this._allowMultiple = _options.allowMultiple ?? true;

		this._wrapper = $<HTMLElement>('div', 'dc-accordion-item');
		this._wrapper.style.cssText = 'display:flex;flex-direction:column;flex-shrink:0;border-bottom:1px solid #1e1e1e;';

		this._header = $<HTMLElement>('div', 'dc-accordion-item-header');
		this._header.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:#bbbbbb;background:#252526;';
		this._header.addEventListener('click', () => this.toggle());
		this._header.addEventListener('contextmenu', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
		});

		this._chevron = $<HTMLElement>('span', 'dc-accordion-item-chevron');
		this._chevron.style.cssText = 'width:10px;font-size:9px;color:#858585;flex-shrink:0;';
		this._header.appendChild(this._chevron);

		if (_options.icon) {
			const icon = $<HTMLElement>('span', 'dc-accordion-item-icon');
			icon.textContent = _options.icon;
			icon.style.cssText = 'font-size:13px;flex-shrink:0;';
			this._header.appendChild(icon);
		}

		this._title = $<HTMLElement>('span', 'dc-accordion-item-title');
		this._title.textContent = _options.title;
		this._title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		this._header.appendChild(this._title);

		this._actions = $<HTMLElement>('div', 'dc-accordion-item-actions');
		this._actions.style.cssText = 'display:none;gap:4px;align-items:center;';
		this._header.appendChild(this._actions);
		this._header.addEventListener('mouseenter', () => {
			this._actions.style.display = 'flex';
		});
		this._header.addEventListener('mouseleave', () => {
			this._actions.style.display = 'none';
		});

		this._body = $<HTMLElement>('div', 'dc-accordion-item-body');
		this._body.style.cssText = 'overflow-y:auto;overflow-x:hidden;flex-shrink:0;';
		this._body.appendChild(_options.content);
		this._wrapper.appendChild(this._header);
		this._wrapper.appendChild(this._body);
		this._applyExpanded();
	}

	get id(): string {
		return this._options.id;
	}

	get element(): HTMLElement {
		return this._wrapper;
	}

	get header(): HTMLElement {
		return this._header;
	}

	get expanded(): boolean {
		return this._expanded;
	}

	setExpanded(expanded: boolean): void {
		if (this._expanded === expanded) {
			return;
		}
		this._expanded = expanded;
		if (expanded && !this._allowMultiple) {
			this._parent.collapseOthers(this.id);
		}
		this._applyExpanded();
		this._onDidToggle.fire({ id: this.id, expanded });
	}

	toggle(): void {
		this.setExpanded(!this._expanded);
	}

	addAction(action: { id: string; icon: string; title?: string; onClick: () => void }): void {
		const btn = $<HTMLElement>('span', 'dc-accordion-item-action');
		btn.textContent = action.icon;
		btn.title = action.title ?? '';
		btn.style.cssText = 'cursor:pointer;color:#858585;font-size:12px;padding:1px 4px;border-radius:3px;';
		btn.addEventListener('mouseenter', () => {
			btn.style.background = '#3c3c3c';
		});
		btn.addEventListener('mouseleave', () => {
			btn.style.background = 'transparent';
		});
		btn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			action.onClick();
		});
		this._actions.appendChild(btn);
	}

	clearActions(): void {
		clearNode(this._actions);
	}

	private _applyExpanded(): void {
		this._chevron.textContent = this._expanded ? '\u25be' : '\u25b8';
		this._body.style.display = this._expanded ? 'block' : 'none';
	}

	dispose(): void {
		this._wrapper.remove();
		super.dispose();
	}
}

export class AccordionView extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _items = new Map<string, AccordionItem>();
	private _activeId: string | null = null;

	private readonly _onDidChange = this._register(new Emitter<IAccordionChangeEvent>());
	readonly onDidChange: Event<IAccordionChangeEvent> = this._onDidChange.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: { allowMultiple?: boolean } = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-accordion-view');
		this._container.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;flex:1;';
		parent.appendChild(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}

	get activeId(): string | null {
		return this._activeId;
	}

	get items(): AccordionItem[] {
		return Array.from(this._items.values());
	}

	addItem(options: IAccordionItemOptions): AccordionItem {
		const existing = this._items.get(options.id);
		if (existing) {
			return existing;
		}
		const item = new AccordionItem({ ...options, allowMultiple: options.allowMultiple ?? this._options.allowMultiple }, this);
		this._register(item);
		item.onDidToggle(e => {
			this._activeId = e.expanded ? e.id : null;
			this._onDidChange.fire(e);
		});
		this._items.set(options.id, item);
		this._container.appendChild(item.element);
		if (item.expanded) {
			this._activeId = options.id;
		}
		return item;
	}

	removeItem(id: string): void {
		const item = this._items.get(id);
		if (!item) {
			return;
		}
		item.dispose();
		this._items.delete(id);
		if (this._activeId === id) {
			this._activeId = null;
		}
	}

	getItem(id: string): AccordionItem | undefined {
		return this._items.get(id);
	}

	expandItem(id: string): void {
		this._items.get(id)?.setExpanded(true);
	}

	collapseItem(id: string): void {
		this._items.get(id)?.setExpanded(false);
	}

	toggleItem(id: string): void {
		this._items.get(id)?.toggle();
	}

	collapseOthers(id: string): void {
		for (const item of this._items.values()) {
			if (item.id !== id && item.expanded) {
				item.setExpanded(false);
			}
		}
	}

	collapseAll(): void {
		for (const item of this._items.values()) {
			if (item.expanded) {
				item.setExpanded(false);
			}
		}
	}

	clear(): void {
		for (const item of this._items.values()) {
			item.dispose();
		}
		this._items.clear();
		this._activeId = null;
	}

	focus(): void {
		this._items.get(this._activeId ?? '')?.header.focus();
	}

	dispose(): void {
		this.clear();
		this._container.remove();
		super.dispose();
	}
}
