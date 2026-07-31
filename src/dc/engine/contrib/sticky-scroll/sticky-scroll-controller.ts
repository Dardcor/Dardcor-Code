/**
 * Dardcor Code - Top Sticky Scope Header Line Renderer
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel } from "../../model/text-model.js";

export interface IStickyLine {
	readonly lineNumber: number;
	readonly text: string;
	readonly indentLevel: number;
}

export interface IStickyScrollHost {
	getContainer(): HTMLElement;
	getModel(): ITextModel | null;
	getLineHeight(): number;
	getScrollTop(): number;
	getViewportHeight(): number;
}

export class StickyScrollController extends Disposable {
	private readonly _host: IStickyScrollHost;
	private readonly _domNode: HTMLElement;
	private _stickyLines: IStickyLine[] = [];
	private _renderedLines: IStickyLine[] = [];

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(host: IStickyScrollHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-sticky-scroll");
		this._domNode.style.cssText = "position:absolute;top:0;left:0;right:0;z-index:30;display:none;background:rgba(30,30,30,0.92);border-bottom:1px solid #3a3a3a;backdrop-filter:blur(2px);overflow:hidden;";
		host.getContainer().appendChild(this._domNode);
		this._register(addDisposableListener(this._domNode, "mousedown", e => e.preventDefault()));
		this._register(addDisposableListener(this._domNode, "click", e => {
			const target = (e.target as HTMLElement).closest(".dc-sticky-line") as HTMLElement | null;
			if (target) {
				const line = Number(target.getAttribute("data-line"));
				if (Number.isInteger(line)) {
					this._onDidChange.fire();
					target.parentElement?.setAttribute("data-jump", String(line));
				}
			}
		}));
	}

	public computeStickyLines(model: ITextModel): IStickyLine[] {
		const lines: IStickyLine[] = [];
		const lineCount = model.getLineCount();
		if (lineCount < 2) {
			return lines;
		}
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		for (let line = 1; line <= lineCount - 1; line++) {
			const text = model.getLineContent(line);
			const next = model.getLineContent(line + 1);
			if (text.trim().length === 0) {
				continue;
			}
			const indentLevel = this._indentLevel(text);
			const nextIndent = this._indentLevel(next);
			// A sticky header: block-start keyword with deeper content following.
			if (nextIndent > indentLevel) {
				const trimmed = text.trim();
				if (this._isBlockStart(trimmed)) {
					lines.push({ lineNumber: line, text: trimmed, indentLevel });
				}
			}
		}
		return lines;
	}

	private _isBlockStart(trimmed: string): boolean {
		const isWord = (ch: string) => /[A-Za-z0-9_$]/.test(ch);
		const first = trimmed[0];
		if (!isWord(first) && first !== "}" && first !== ")" && first !== "]") {
			return false;
		}
		if (/^(?:if|else|for|while|switch|case|try|catch|finally|do|function|class|interface|enum|namespace|module|public|private|protected|static|async|export|import)\b/.test(trimmed)) {
			return true;
		}
		return /\)\s*\{|\)\s*=>\s*\{|\)\s*;?\s*$/.test(trimmed) && trimmed.includes("(");
	}

	private _indentLevel(text: string): number {
		let level = 0;
		for (const ch of text) {
			if (ch === " ") {
				level++;
			} else if (ch === "\t") {
				level += 4;
			} else {
				break;
			}
		}
		return Math.floor(level / 4);
	}

	public update(scrollTop: number, viewportHeight: number, lineHeight: number): void {
		const model = this._host.getModel();
		if (!model) {
			this._domNode.style.display = "none";
			return;
		}
		this._stickyLines = this._stickyLines.length === 0 ? this.computeStickyLines(model) : this._stickyLines;
		const firstVisibleLine = Math.floor(scrollTop / lineHeight) + 1;
		const maxSticky = Math.max(0, Math.floor(viewportHeight / lineHeight) - 2);
		const rendered: IStickyLine[] = [];
		for (const sticky of this._stickyLines) {
			if (sticky.lineNumber < firstVisibleLine) {
				rendered.push(sticky);
			} else {
				break;
			}
			if (rendered.length >= maxSticky) {
				break;
			}
		}
		const changed = JSON.stringify(rendered) !== JSON.stringify(this._renderedLines);
		this._renderedLines = rendered;
		if (changed) {
			this._render();
		}
	}

	private _render(): void {
		clearNode(this._domNode);
		if (this._renderedLines.length === 0) {
			this._domNode.style.display = "none";
			return;
		}
		this._domNode.style.display = "block";
		for (const sticky of this._renderedLines) {
			const row = $<HTMLElement>("div", "dc-sticky-line");
			row.setAttribute("data-line", String(sticky.lineNumber));
			row.style.cssText = "padding:2px 8px;font-family:Consolas, monospace;font-size:13px;color:#a8c7fa;white-space:pre;cursor:pointer;";
			row.textContent = " ".repeat(sticky.indentLevel * 4) + sticky.text;
			row.title = `Line ${sticky.lineNumber} — click to jump`;
			this._domNode.appendChild(row);
		}
	}

	public getStickyLines(): readonly IStickyLine[] {
		return this._stickyLines;
	}

	public getRenderedLines(): readonly IStickyLine[] {
		return this._renderedLines;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
