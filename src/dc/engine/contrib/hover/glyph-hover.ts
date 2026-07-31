/**
 * Dardcor Code - Glyph Margin Annotation Hover Card
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IPosition } from "../../model/text-model.js";
import { MarkdownString } from "./markdown-hover.js";

export interface IGlyphAnnotation {
	readonly lineNumber: number;
	readonly glyph: string;
	readonly message: MarkdownString | string;
	readonly severity: "error" | "warning" | "info" | "breakpoint";
}

export interface IGlyphHoverAnchor {
	readonly x: number;
	readonly y: number;
	readonly height: number;
}

export interface IGlyphHoverHost {
	getContainer(): HTMLElement;
	getAnchorForLine(lineNumber: number): IGlyphHoverAnchor | null;
}

const SEVERITY_COLORS: Record<IGlyphAnnotation["severity"], string> = {
	error: "#f48771",
	warning: "#cca700",
	info: "#75beff",
	breakpoint: "#e51400"
};

/**
 * Hover card that pops up over the glyph margin (gutter) showing breakpoint,
 * error and warning annotations registered for a line. The card content is a
 * simple list of messages and closes on mouse leave or Escape.
 */
export class GlyphHover extends Disposable {
	private readonly _host: IGlyphHoverHost;
	private readonly _domNode: HTMLElement;
	private readonly _contentNode: HTMLElement;
	private readonly _annotations = new Map<number, IGlyphAnnotation[]>();
	private _isVisible: boolean = false;
	private _lineNumber: number = -1;
	private _hideTimer: any = null;

	private readonly _onDidShow = this._register(new Emitter<IGlyphAnnotation[]>());
	readonly onDidShow: Event<IGlyphAnnotation[]> = this._onDidShow.event;

	constructor(host: IGlyphHoverHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-glyph-hover");
		this._contentNode = $<HTMLElement>("div", "dc-glyph-hover-content");
		this._domNode.appendChild(this._contentNode);
		this._domNode.style.cssText = "position:absolute;z-index:61;display:none;min-width:200px;max-width:420px;background:#252526;border:1px solid #454545;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.5);padding:6px 10px;font-family:Segoe UI, sans-serif;font-size:12px;color:#d4d4d4;line-height:1.5;";
		host.getContainer().appendChild(this._domNode);
		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._domNode, "mouseleave", () => this.scheduleHide()));
		this._register(addDisposableListener(this._domNode, "mouseenter", () => this.cancelHide()));
	}

	public addAnnotation(annotation: IGlyphAnnotation): void {
		let list = this._annotations.get(annotation.lineNumber);
		if (!list) {
			list = [];
			this._annotations.set(annotation.lineNumber, list);
		}
		list.push(annotation);
	}

	public removeAnnotations(lineNumber: number): void {
		this._annotations.delete(lineNumber);
		if (this._lineNumber === lineNumber) {
			this.hide();
		}
	}

	public clearAnnotations(): void {
		this._annotations.clear();
		this.hide();
	}

	public getAnnotations(lineNumber: number): readonly IGlyphAnnotation[] {
		return this._annotations.get(lineNumber) ?? [];
	}

	public show(lineNumber: number): void {
		const annotations = this._annotations.get(lineNumber);
		const anchor = this._host.getAnchorForLine(lineNumber);
		if (!annotations || annotations.length === 0 || !anchor) {
			this.hide();
			return;
		}
		this._lineNumber = lineNumber;
		this.cancelHide();
		this._render(annotations);
		this._position(anchor);
		this._domNode.style.display = "block";
		this._isVisible = true;
		this._onDidShow.fire(annotations);
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
		this._lineNumber = -1;
		this._domNode.style.display = "none";
	}

	public scheduleHide(delay: number = 150): void {
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

	private _render(annotations: readonly IGlyphAnnotation[]): void {
		clearNode(this._contentNode);
		for (const annotation of annotations) {
			const row = $<HTMLElement>("div", "dc-glyph-hover-row");
			row.style.cssText = "display:flex;gap:8px;align-items:baseline;padding:2px 0;";
			const glyph = $<HTMLElement>("span", "dc-glyph-hover-glyph");
			glyph.textContent = annotation.glyph;
			glyph.style.cssText = `flex:none;width:14px;color:${SEVERITY_COLORS[annotation.severity]};`;
			const message = $<HTMLElement>("span", "dc-glyph-hover-message");
			message.textContent = typeof annotation.message === "string" ? annotation.message : annotation.message.value;
			message.style.cssText = "color:#d4d4d4;white-space:pre-wrap;word-break:break-word;";
			row.appendChild(glyph);
			row.appendChild(message);
			this._contentNode.appendChild(row);
		}
	}

	private _position(anchor: IGlyphHoverAnchor): void {
		const parent = this._domNode.parentElement;
		if (!parent) {
			return;
		}
		const rect = parent.getBoundingClientRect();
		const nodeRect = this._domNode.getBoundingClientRect();
		let left = anchor.x + 6;
		let top = anchor.y;
		if (left + nodeRect.width > rect.width - 4) {
			left = Math.max(0, rect.width - nodeRect.width - 4);
		}
		if (top + nodeRect.height > rect.height - 4) {
			top = Math.max(0, anchor.y - nodeRect.height);
		}
		this._domNode.style.left = `${Math.round(left)}px`;
		this._domNode.style.top = `${Math.round(top)}px`;
	}

	public override dispose(): void {
		this.cancelHide();
		this._domNode.remove();
		super.dispose();
	}
}

export function isModelPosition(value: unknown): value is IPosition {
	return !!value && typeof (value as IPosition).lineNumber === "number" && typeof (value as IPosition).column === "number";
}

export function getGlyphAtPosition(model: ITextModel, position: IPosition): string | null {
	const line = model.getLineContent(position.lineNumber);
	if (position.column < 1 || position.column > line.length + 1) {
		return null;
	}
	return line[position.column - 1] ?? null;
}
