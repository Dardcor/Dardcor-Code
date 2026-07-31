/**
 * Dardcor Code - Embedded Inline Reference Peek View Container
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";

export interface IPeekViewAnchor {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}

export interface IPeekViewLayoutOptions {
	readonly heightRatio?: number;
	readonly maxHeight?: number;
}

export class PeekViewWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _headerNode: HTMLElement;
	private readonly _titleNode: HTMLElement;
	private readonly _actionsNode: HTMLElement;
	private readonly _bodyNode: HTMLElement;
	private readonly _parent: HTMLElement;
	private _isVisible: boolean = false;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(parent: HTMLElement) {
		super();
		this._parent = parent;
		this._domNode = $<HTMLElement>("div", "dc-peek-view-widget");
		this._headerNode = $<HTMLElement>("div", "dc-peek-view-header");
		this._titleNode = $<HTMLElement>("span", "dc-peek-view-title");
		this._actionsNode = $<HTMLElement>("div", "dc-peek-view-actions");
		this._bodyNode = $<HTMLElement>("div", "dc-peek-view-body");

		this._domNode.style.cssText = "position:absolute;z-index:65;display:none;left:0;right:0;background:#252526;border-top:1px solid #454545;box-shadow:0 -4px 18px rgba(0,0,0,0.5);";
		this._headerNode.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid #3a3a3a;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;";
		this._titleNode.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
		this._actionsNode.style.cssText = "margin-left:auto;display:flex;align-items:center;gap:4px;";
		this._bodyNode.style.cssText = "overflow:auto;height:100%;";

		const closeButton = $<HTMLButtonElement>("button", "dc-peek-view-close");
		closeButton.textContent = "✕";
		closeButton.title = "Close (Esc)";
		closeButton.style.cssText = "background:transparent;border:none;color:#9e9e9e;cursor:pointer;font-size:13px;padding:0 4px;";
		this._register(addDisposableListener(closeButton, "click", () => this.hide()));

		this._headerNode.appendChild(this._titleNode);
		this._headerNode.appendChild(this._actionsNode);
		this._actionsNode.appendChild(closeButton);
		this._domNode.appendChild(this._headerNode);
		this._domNode.appendChild(this._bodyNode);
		parent.appendChild(this._domNode);
	}

	public show(anchor: IPeekViewAnchor, title: string, body: HTMLElement | null, options: IPeekViewLayoutOptions = {}): void {
		this.setTitle(title);
		if (body) {
			this.setBody(body);
		}
		const rect = this._parent.getBoundingClientRect();
		const ratio = options.heightRatio ?? 0.6;
		const height = Math.min(options.maxHeight ?? rect.height * ratio, Math.max(120, rect.height - anchor.y - 8));
		this._domNode.style.height = `${Math.round(height)}px`;
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public hide(): void {
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._domNode.style.display = "none";
		this._onDidClose.fire();
	}

	public setTitle(title: string): void {
		this._titleNode.textContent = title;
	}

	public setBody(body: HTMLElement | null): void {
		clearNode(this._bodyNode);
		if (body) {
			this._bodyNode.appendChild(body);
		}
	}

	public clearBody(): void {
		clearNode(this._bodyNode);
	}

	public addAction(button: HTMLElement): void {
		this._actionsNode.appendChild(button);
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getBody(): HTMLElement {
		return this._bodyNode;
	}

	public layout(options: IPeekViewLayoutOptions = {}): void {
		if (!this._isVisible) {
			return;
		}
		const rect = this._parent.getBoundingClientRect();
		const ratio = options.heightRatio ?? 0.6;
		const height = Math.min(options.maxHeight ?? rect.height * ratio, Math.max(120, rect.height - 8));
		this._domNode.style.height = `${Math.round(height)}px`;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
