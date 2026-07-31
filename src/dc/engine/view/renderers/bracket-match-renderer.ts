/**
 * Dardcor Code - Matching Bracket Pair Highlight Renderer (Task 250)
 * Mirrors: vs/editor/contrib/bracketMatching/browser/bracketMatching.ts
 */

import { $ } from '../../../core/dom/element.js';
import { Disposable } from '../../../core/lifecycle/disposable.js';
import { IRange, Range } from '../../model/text-model.js';

export interface IBracketMatchRange {
	readonly range: Range;
	readonly char: string;
}

export interface IBracketMatchRenderOptions {
	readonly lineHeight: number;
	readonly highlightColor: string;
	readonly borderColor: string;
}

export class BracketMatchRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private _ranges: IBracketMatchRange[] = [];
	private _lineHeight: number;
	private _highlightColor: string;
	private _borderColor: string;
	private _scrollTop = 0;
	private _scrollLeft = 0;
	private _charWidth = 7.5;

	constructor(container: HTMLElement, options: Partial<IBracketMatchRenderOptions> = {}) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-bracket-match');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
		container.appendChild(this._domNode);
		this._lineHeight = options.lineHeight ?? 19;
		this._highlightColor = options.highlightColor ?? 'rgba(255,255,255,0.08)';
		this._borderColor = options.borderColor ?? '#a0a0a0';
	}

	public setRanges(ranges: readonly IBracketMatchRange[]): void {
		this._ranges = [...ranges];
		this._render();
	}

	public clear(): void {
		this._ranges = [];
		this._render();
	}

	public setScroll(scrollTop: number, scrollLeft: number): void {
		this._scrollTop = Math.max(0, scrollTop);
		this._scrollLeft = Math.max(0, scrollLeft);
		this._render();
	}

	public setLineHeight(lineHeight: number): void {
		this._lineHeight = Math.max(1, lineHeight);
		this._render();
	}

	public setCharWidth(charWidth: number): void {
		this._charWidth = Math.max(1, charWidth);
		this._render();
	}

	public render(scrollTop: number, scrollLeft: number): void {
		this.setScroll(scrollTop, scrollLeft);
	}

	private _render(): void {
		this._domNode.innerHTML = '';
		for (const entry of this._ranges) {
			const { range } = entry;
			if (range.startLineNumber !== range.endLineNumber) {
				continue;
			}
			const top = (range.startLineNumber - 1) * this._lineHeight - this._scrollTop;
			const left = (range.startColumn - 1) * this._charWidth - this._scrollLeft;
			const width = Math.max(1, (range.endColumn - range.startColumn) * this._charWidth);

			const box = $<HTMLElement>('div', 'dc-bracket-match-box');
			box.style.cssText = `position:absolute;top:${top}px;left:${left}px;width:${width}px;height:${this._lineHeight}px;background:${this._highlightColor};box-sizing:border-box;`;
			box.style.borderTop = `1px solid ${this._borderColor}`;
			box.style.borderBottom = `1px solid ${this._borderColor}`;
			this._domNode.appendChild(box);
		}
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public static findMatchingBracket(
		lineGetter: (lineNumber: number) => string,
		startLineNumber: number,
		startColumn: number
	): IRange | null {
		const line = lineGetter(startLineNumber);
		if (!line) {
			return null;
		}
		const char = line.charAt(startColumn - 1);
		const openChars = '([{';
		const closeChars = ')]}';
		const openIndex = openChars.indexOf(char);
		const closeIndex = closeChars.indexOf(char);

		if (openIndex === -1 && closeIndex === -1) {
			return null;
		}

		const openChar = openChars.charAt(closeIndex !== -1 ? closeIndex : openIndex);
		const closeChar = closeChars.charAt(closeIndex !== -1 ? closeIndex : openIndex);
		let depth = 1;
		let lineNumber = startLineNumber;
		let column = startColumn;
		let content = line;

		const step = closeIndex !== -1 ? -1 : 1;
		const stopChar = closeIndex !== -1 ? openChar : closeChar;

		column += step;
		while (true) {
			if (column < 1) {
				lineNumber -= 1;
				content = lineGetter(lineNumber);
				if (!content) {
					return null;
				}
				column = content.length;
			} else if (column > content.length) {
				lineNumber += 1;
				content = lineGetter(lineNumber);
				if (!content) {
					return null;
				}
				column = 1;
			}

			const ch = content.charAt(column - 1);
			if (ch === (step > 0 ? openChar : closeChar)) {
				depth++;
			} else if (ch === stopChar) {
				depth--;
			}
			if (depth === 0) {
				return new Range(lineNumber, column, lineNumber, column + 1);
			}
			column += step;
		}
	}
}
