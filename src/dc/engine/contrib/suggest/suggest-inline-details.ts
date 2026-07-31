/**
 * Dardcor Code - Suggestion Documentation Popover Panel
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { CompletionItem, getCompletionItemKindName } from "./completion-item.js";
import { renderMarkdownAsHtml } from "../hover/markdown-hover.js";

export interface ISuggestInlineDetailsAnchor {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export class SuggestInlineDetails extends Disposable {
	private readonly _domNode: HTMLElement;
	private _item: CompletionItem | null = null;
	private _isVisible: boolean = false;

	private readonly _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide: Event<void> = this._onDidHide.event;

	constructor(parent: HTMLElement) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-suggest-inline-details");
		this._domNode.style.cssText = "position:absolute;z-index:51;display:none;width:320px;max-height:240px;overflow-y:auto;background:#2b2b2b;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:8px 12px;font-family:Segoe UI, sans-serif;font-size:12px;color:#d4d4d4;line-height:1.5;";
		parent.appendChild(this._domNode);
		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
	}

	public show(anchor: ISuggestInlineDetailsAnchor, item: CompletionItem): void {
		this._item = item;
		clearNode(this._domNode);
		this._render(item);
		this._position(anchor);
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._item = null;
		this._domNode.style.display = "none";
		this._onDidHide.fire();
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getItem(): CompletionItem | null {
		return this._item;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _render(item: CompletionItem): void {
		const kindLabel = $<HTMLElement>("div", "dc-suggest-inline-details-kind");
		kindLabel.textContent = getCompletionItemKindName(item.kind);
		kindLabel.style.cssText = "font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#75beff;margin-bottom:4px;";

		const label = $<HTMLElement>("div", "dc-suggest-inline-details-label");
		label.textContent = item.label;
		label.style.cssText = "font-family:Consolas, monospace;font-size:14px;color:#e8e8e8;font-weight:bold;";

		this._domNode.appendChild(kindLabel);
		this._domNode.appendChild(label);

		if (item.detail) {
			const detail = $<HTMLElement>("div", "dc-suggest-inline-details-detail");
			detail.textContent = item.detail;
			detail.style.cssText = "margin-top:2px;color:#969696;";
			this._domNode.appendChild(detail);
		}

		if (item.documentation) {
			const docs = $<HTMLElement>("div", "dc-suggest-inline-details-docs");
			docs.style.cssText = "margin-top:6px;border-top:1px solid #3a3a3a;padding-top:6px;color:#b5b5b5;";
			docs.innerHTML = renderMarkdownAsHtml(item.documentation);
			this._domNode.appendChild(docs);
		}
	}

	private _position(anchor: ISuggestInlineDetailsAnchor): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		let left = anchor.x + anchor.width + 6;
		let top = anchor.y;
		if (left + this._domNode.offsetWidth > rect.width) {
			left = Math.max(0, anchor.x - this._domNode.offsetWidth - 6);
		}
		if (top + this._domNode.offsetHeight > rect.height) {
			top = Math.max(0, rect.height - this._domNode.offsetHeight);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
