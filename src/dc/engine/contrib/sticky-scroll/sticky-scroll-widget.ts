/**
 * Dardcor Code - Floating Top Sticky Line DOM Header Overlay Widget
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { IStickyLine } from "./sticky-scroll-controller.js";

export interface IStickyScrollWidgetHost {
	getContainer(): HTMLElement;
	getLineHeight(): number;
}

export class StickyScrollWidget extends Disposable {
	private readonly _host: IStickyScrollWidgetHost;
	private readonly _domNode: HTMLElement;
	private _lines: IStickyLine[] = [];
	private _isVisible: boolean = false;

	private readonly _onDidSelectLine = this._register(new Emitter<number>());
	readonly onDidSelectLine: Event<number> = this._onDidSelectLine.event;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: IStickyScrollWidgetHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-sticky-scroll-widget");
		this._domNode.style.cssText = "position:absolute;top:0;left:0;right:0;z-index:30;display:none;background:rgba(30,30,30,0.92);border-bottom:1px solid #3a3a3a;backdrop-filter:blur(2px);overflow:hidden;";
		host.getContainer().appendChild(this._domNode);
		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._domNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-sticky-line") as HTMLElement | null;
			if (target) {
				const line = Number(target.getAttribute("data-line"));
				if (Number.isInteger(line)) {
					this._onDidSelectLine.fire(line);
				}
			}
		}));
	}

	public render(lines: IStickyLine[]): void {
		this._lines = lines;
		clearNode(this._domNode);
		if (lines.length === 0) {
			this._isVisible = false;
			this._domNode.style.display = "none";
			this._onDidChange.fire();
			return;
		}
		this._isVisible = true;
		this._domNode.style.display = "block";
		const lineHeight = this._host.getLineHeight();
		for (const sticky of lines) {
			const row = $<HTMLElement>("div", "dc-sticky-line");
			row.setAttribute("data-line", String(sticky.lineNumber));
			row.style.cssText = `padding:2px 8px;font-family:Consolas, monospace;font-size:13px;line-height:${lineHeight - 4}px;color:#a8c7fa;white-space:pre;cursor:pointer;`;
			row.textContent = " ".repeat(sticky.indentLevel * 4) + sticky.text;
			row.title = `Line ${sticky.lineNumber} - click to jump`;
			this._domNode.appendChild(row);
		}
		this._onDidChange.fire();
	}

	public hide(): void {
		this.render([]);
	}

	public get isVisible(): boolean {
		return this._isVisible;
	}

	public getRenderedLines(): readonly IStickyLine[] {
		return this._lines;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public setWidth(width: number): void {
		this._domNode.style.width = `${Math.round(width)}px`;
	}

	public layout(): void {
		if (this._isVisible && this._lines.length > 0) {
			this.render(this._lines);
		}
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
