/**
 * Dardcor Code - Hover Tooltip UI Card Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { IPosition2D } from "../../../core/math/position.js";

export interface IHoverAnchor {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}

export class HoverWidget extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _contentNode: HTMLElement;
	private _isVisible: boolean = false;
	private _hideTimer: any = null;

	private readonly _onDidHide = this._register(new Emitter<void>());
	readonly onDidHide: Event<void> = this._onDidHide.event;

	constructor(parent: HTMLElement) {
		super();
		this._domNode = $<HTMLElement>("div", "dc-hover-widget");
		this._contentNode = $<HTMLElement>("div", "dc-hover-widget-content");

		this._domNode.appendChild(this._contentNode);
		this._domNode.style.cssText = "position:absolute;z-index:60;display:none;max-width:520px;max-height:300px;overflow-y:auto;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:8px 12px;font-family:Consolas, monospace;font-size:13px;color:#d4d4d4;line-height:1.5;";
		parent.appendChild(this._domNode);

		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
	}

	public show(content: HTMLElement, anchor: IHoverAnchor): void {
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
		clearNode(this._contentNode);
		this._contentNode.appendChild(content);
		this._position(anchor);
		this._domNode.style.display = "block";
		this._isVisible = true;
	}

	public showHtml(html: string, anchor: IHoverAnchor): void {
		const node = $<HTMLElement>("div");
		node.innerHTML = html;
		this.show(node, anchor);
	}

	public hide(): void {
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		this._domNode.style.display = "none";
		this._onDidHide.fire();
	}

	public scheduleHide(delay: number = 200): void {
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
		}
		this._hideTimer = setTimeout(() => {
			this._hideTimer = null;
			this.hide();
		}, delay);
	}

	public cancelHide(): void {
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	private _position(anchor: IHoverAnchor): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		const nodeRect = this._domNode.getBoundingClientRect();
		const width = Math.min(nodeRect.width, rect.width - 8);
		const height = Math.min(nodeRect.height, rect.height - 8);
		let left = anchor.x;
		let top = anchor.y + anchor.height;
		if (top + height > rect.height - 4) {
			top = Math.max(0, anchor.y - height - 4);
		}
		if (left + width > rect.width - 4) {
			left = Math.max(0, rect.width - width - 4);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
		this._domNode.style.maxWidth = `${width}px`;
	}

	public layout(): void {
		if (this._isVisible) {
			this._domNode.style.maxHeight = "300px";
		}
	}

	public override dispose(): void {
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
		}
		this._domNode.remove();
		super.dispose();
	}
}

export function isPosition2D(value: unknown): value is IPosition2D {
	return !!value && typeof (value as IPosition2D).x === "number" && typeof (value as IPosition2D).y === "number";
}
