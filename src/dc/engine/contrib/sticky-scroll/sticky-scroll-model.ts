/**
 * Dardcor Code - Top Scope Sticky Line Calculator Model
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { ITextModel } from "../../model/text-model.js";
import { IStickyLine } from "./sticky-scroll-controller.js";

export interface IStickyScrollModelState {
	readonly stickyLines: readonly IStickyLine[];
	readonly visibleLines: readonly IStickyLine[];
	readonly firstVisibleLine: number;
}

const BLOCK_START_RE = /^(?:if|else|for|while|switch|case|try|catch|finally|do|function|class|interface|enum|namespace|module|public|private|protected|static|async|export|import)\b/;

export class StickyScrollModel extends Disposable {
	private _stickyLines: IStickyLine[] = [];
	private _visibleLines: IStickyLine[] = [];
	private _firstVisibleLine: number = 1;

	private readonly _onDidChange = this._register(new Emitter<IStickyScrollModelState>());
	readonly onDidChange: Event<IStickyScrollModelState> = this._onDidChange.event;

	public computeStickyLines(model: ITextModel): IStickyLine[] {
		const lines: IStickyLine[] = [];
		const lineCount = model.getLineCount();
		if (lineCount < 2) {
			return lines;
		}
		for (let line = 1; line <= lineCount - 1; line++) {
			const text = model.getLineContent(line);
			const next = model.getLineContent(line + 1);
			if (text.trim().length === 0) {
				continue;
			}
			const indentLevel = this._indentLevel(text);
			if (this._indentLevel(next) > indentLevel) {
				const trimmed = text.trim();
				if (this._isBlockStart(trimmed)) {
					lines.push({ lineNumber: line, text: trimmed, indentLevel });
				}
			}
		}
		return lines;
	}

	public update(model: ITextModel | null, scrollTop: number, viewportHeight: number, lineHeight: number): void {
		if (!model || lineHeight <= 0) {
			this._stickyLines = [];
			this._visibleLines = [];
			this._firstVisibleLine = 1;
			this._onDidChange.fire(this.getState());
			return;
		}
		this._stickyLines = this._stickyLines.length === 0 ? this.computeStickyLines(model) : this._stickyLines;
		this._firstVisibleLine = Math.floor(scrollTop / lineHeight) + 1;
		const maxSticky = Math.max(0, Math.floor(viewportHeight / lineHeight) - 2);
		const rendered: IStickyLine[] = [];
		for (const sticky of this._stickyLines) {
			if (sticky.lineNumber < this._firstVisibleLine) {
				rendered.push(sticky);
			} else {
				break;
			}
			if (rendered.length >= maxSticky) {
				break;
			}
		}
		this._visibleLines = rendered;
		this._onDidChange.fire(this.getState());
	}

	public reset(): void {
		this._stickyLines = [];
		this._visibleLines = [];
		this._firstVisibleLine = 1;
		this._onDidChange.fire(this.getState());
	}

	public getStickyLines(): readonly IStickyLine[] {
		return this._stickyLines;
	}

	public getVisibleLines(): readonly IStickyLine[] {
		return this._visibleLines;
	}

	public getFirstVisibleLine(): number {
		return this._firstVisibleLine;
	}

	public getState(): IStickyScrollModelState {
		return {
			stickyLines: this._stickyLines,
			visibleLines: this._visibleLines,
			firstVisibleLine: this._firstVisibleLine
		};
	}

	private _isBlockStart(trimmed: string): boolean {
		const first = trimmed[0];
		if (!/[A-Za-z_$]/.test(first ?? "") && first !== "}" && first !== ")" && first !== "]") {
			return false;
		}
		if (BLOCK_START_RE.test(trimmed)) {
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
}
