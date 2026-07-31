/**
 * Dardcor Code - Autocomplete Popup UI Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { CompletionItem, CompletionItemKind } from "./completion-item.js";

export interface ISuggestAnchor {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface ISuggestWidgetHost {
	getContainer(): HTMLElement;
}

export class SuggestWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _listNode: HTMLElement;
	private readonly _messageNode: HTMLElement;
	private _items: CompletionItem[] = [];
	private _query: string = "";
	private _selectedIndex: number = -1;
	private _isVisible: boolean = false;

	private readonly _onDidSelect = this._register(new Emitter<CompletionItem>());
	readonly onDidSelect: Event<CompletionItem> = this._onDidSelect.event;

	private readonly _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide: Event<void> = this._onDidHide.event;

	constructor(host: ISuggestWidgetHost) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-suggest-widget");
		this._listNode = $<HTMLElement>("div", "dc-suggest-widget-list");
		this._messageNode = $<HTMLElement>("div", "dc-suggest-widget-message");

		this._domNode.appendChild(this._listNode);
		this._domNode.appendChild(this._messageNode);
		this._domNode.style.cssText = "position:absolute;z-index:50;display:none;min-width:240px;max-width:480px;max-height:260px;overflow-y:auto;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;";
		this._listNode.style.cssText = "padding:4px 0;";
		this._messageNode.style.cssText = "display:none;padding:8px 12px;color:#969696;";

		host.getContainer().appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._listNode, "mouseover", e => {
			const target = (e.target as HTMLElement).closest(".dc-suggest-item") as HTMLElement | null;
			if (target) {
				const index = Number(target.getAttribute("data-index"));
				if (Number.isInteger(index) && index !== this._selectedIndex) {
					this._select(index);
				}
			}
		}));
		this._register(addDisposableListener(this._listNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-suggest-item") as HTMLElement | null;
			if (target) {
				this._onDidSelect.fire(this._items[Number(target.getAttribute("data-index"))]);
			}
		}));
		this._register(addDisposableListener(this._domNode, "keydown", e => this._onKeyDown(e as KeyboardEvent)));
	}

	public show(anchor: ISuggestAnchor, items: CompletionItem[], query: string): void {
		this._items = items;
		this._query = query;
		this._renderList();
		this._position(anchor);
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._domNode.style.display = "none";
		this._onDidHide.fire();
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public get selectedItem(): CompletionItem | null {
		return this._selectedIndex >= 0 ? this._items[this._selectedIndex] ?? null : null;
	}

	public get selectedIndex(): number {
		return this._selectedIndex;
	}

	public selectNext(): void {
		if (this._items.length === 0) {
			return;
		}
		this._select(this._selectedIndex < 0 ? 0 : (this._selectedIndex + 1) % this._items.length);
	}

	public selectPrevious(): void {
		if (this._items.length === 0) {
			return;
		}
		this._select(this._selectedIndex < 0 ? 0 : (this._selectedIndex - 1 + this._items.length) % this._items.length);
	}

	public acceptSelected(): void {
		const item = this.selectedItem;
		if (item) {
			this._onDidSelect.fire(item);
		}
	}

	private _select(index: number): void {
		this._selectedIndex = index;
		const prev = this._listNode.querySelector(".dc-suggest-item.selected");
		if (prev) {
			prev.classList.remove("selected");
		}
		const el = this._listNode.querySelector(`.dc-suggest-item[data-index="${index}"]`);
		if (el) {
			el.classList.add("selected");
			el.scrollIntoView({ block: "nearest" });
		}
	}

	private _renderList(): void {
		clearNode(this._listNode);
		if (this._items.length === 0) {
			this._messageNode.style.display = "block";
			this._messageNode.textContent = "No suggestions.";
			return;
		}
		this._messageNode.style.display = "none";
		this._selectedIndex = 0;
		for (let i = 0; i < this._items.length; i++) {
			this._listNode.appendChild(this._renderItem(this._items[i], i, this._query));
		}
	}

	private _renderItem(item: CompletionItem, index: number, query: string): HTMLElement {
		const row = $<HTMLElement>("div", "dc-suggest-item");
		row.setAttribute("data-index", String(index));
		if (index === this._selectedIndex) {
			row.classList.add("selected");
		}
		row.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 12px;cursor:pointer;";
		row.classList.add("selected"); // initial selection is index 0

		const kind = $<HTMLElement>("span", "dc-suggest-item-kind");
		kind.textContent = this._kindIcon(item.kind);
		kind.style.cssText = "flex:none;width:18px;text-align:center;color:#75beff;";

		const label = $<HTMLElement>("span", "dc-suggest-item-label");
		const low = item.label.toLowerCase();
		const q = query.toLowerCase();
		let last = 0;
		for (let i = 0; i < q.length; i++) {
			const idx = low.indexOf(q[i], last);
			if (idx === -1 || idx >= item.label.length) {
				continue;
			}
			if (idx > last) {
				label.appendChild(document.createTextNode(item.label.substring(last, idx)));
			}
			const mark = $<HTMLElement>("span", "dc-suggest-item-highlight");
			mark.textContent = item.label[idx];
			mark.style.cssText = "color:#ffd700;font-weight:bold;";
			label.appendChild(mark);
			last = idx + 1;
		}
		if (last < item.label.length) {
			label.appendChild(document.createTextNode(item.label.substring(last)));
		}

		const detail = $<HTMLElement>("span", "dc-suggest-item-detail");
		detail.textContent = item.detail;
		detail.style.cssText = "margin-left:auto;color:#969696;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px;";

		row.appendChild(kind);
		row.appendChild(label);
		row.appendChild(detail);
		return row;
	}

	private _kindIcon(kind: CompletionItemKind): string {
		switch (kind) {
			case CompletionItemKind.Function:
			case CompletionItemKind.Method:
			case CompletionItemKind.Constructor:
				return "ƒ";
			case CompletionItemKind.Class:
			case CompletionItemKind.Interface:
			case CompletionItemKind.Struct:
				return "C";
			case CompletionItemKind.Enum:
				return "E";
			case CompletionItemKind.Keyword:
				return "k";
			case CompletionItemKind.Variable:
			case CompletionItemKind.Field:
			case CompletionItemKind.Property:
				return "v";
			case CompletionItemKind.Snippet:
				return "#";
			case CompletionItemKind.Color:
				return "◉";
			default:
				return "•";
		}
	}

	private _position(anchor: ISuggestAnchor): void {
		const container = this._domNode.parentElement;
		if (!container) {
			return;
		}
		const rect = container.getBoundingClientRect();
		const nodeHeight = this._domNode.offsetHeight;
		let left = anchor.x;
		let top = anchor.y + anchor.height;
		if (top + nodeHeight > rect.height) {
			top = Math.max(0, anchor.y - nodeHeight);
		}
		if (left + this._domNode.offsetWidth > rect.width) {
			left = Math.max(0, rect.width - this._domNode.offsetWidth);
		}
		this._domNode.style.left = `${left}px`;
		this._domNode.style.top = `${top}px`;
	}

	private _onKeyDown(e: KeyboardEvent): void {
		if (!this._isVisible) {
			return;
		}
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				e.stopPropagation();
				this.selectNext();
				break;
			case "ArrowUp":
				e.preventDefault();
				e.stopPropagation();
				this.selectPrevious();
				break;
			case "Enter":
				e.preventDefault();
				e.stopPropagation();
				this.acceptSelected();
				break;
			case "Escape":
				e.preventDefault();
				e.stopPropagation();
				this.hide();
				break;
		}
	}

	public layout(): void {
		// Keeps the widget within the container bounds; called on resize.
		if (this._isVisible) {
			this._domNode.style.maxHeight = "260px";
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
