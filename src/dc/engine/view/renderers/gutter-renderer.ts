/**
 * Dardcor Code - Line Numbers & Glyph Margin Renderer (Task 212)
 * Mirrors: vs/editor/browser/viewParts/lineNumbers/lineNumbers.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $, clearNode } from '../../../core/dom/element';
import { IRenderContext } from '../../options/editor-options';

export const GUTTER_GLYPH_MARGIN_WIDTH = 24;
export const GUTTER_LINE_NUMBER_WIDTH = 48;

export class GutterRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private readonly _glyphMargin: HTMLElement;
	private readonly _lineNumbers: HTMLElement;
	private _width = GUTTER_GLYPH_MARGIN_WIDTH + GUTTER_LINE_NUMBER_WIDTH;

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-gutter');
		this._glyphMargin = $<HTMLElement>('div', 'dc-glyph-margin');
		this._lineNumbers = $<HTMLElement>('div', 'dc-line-numbers');
		this._domNode.appendChild(this._glyphMargin);
		this._domNode.appendChild(this._lineNumbers);
		this._domNode.style.cssText = 'position:absolute;top:0;bottom:0;left:0;overflow:hidden;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	getWidth(): number {
		return this._width;
	}

	render(ctx: IRenderContext): void {
		const { layout, viewport, viewModel, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const lineNumbersMode = options.lineNumbers;

		clearNode(this._glyphMargin);
		clearNode(this._lineNumbers);

		if (lineNumbersMode === 'off') {
			this._width = GUTTER_GLYPH_MARGIN_WIDTH;
			this._domNode.style.width = `${this._width}px`;
			return;
		}

		const primaryActiveLine = (ctx.cursors && ctx.cursors.length > 0) ? ctx.cursors[0].active.lineNumber : -1;
		const gutterHeight = (layout && layout.getScrollHeight) ? layout.getScrollHeight() : viewport.height;
		this._glyphMargin.style.height = `${gutterHeight}px`;
		this._lineNumbers.style.height = `${gutterHeight}px`;
		this._width = GUTTER_GLYPH_MARGIN_WIDTH + GUTTER_LINE_NUMBER_WIDTH;
		this._domNode.style.width = `${this._width}px`;

		for (let line = viewport.startLineNumber; line <= viewport.endLineNumber; line++) {
			let numberText: string;
			if (lineNumbersMode === 'relative') {
				if (primaryActiveLine > 0) {
					const delta = Math.abs(line - primaryActiveLine);
					numberText = delta === 0 ? String(line) : String(delta);
				} else {
					numberText = String(line);
				}
			} else {
				numberText = String(line);
			}

			const lineNumberEl = $<HTMLElement>('div', 'dc-line-number');
			lineNumberEl.textContent = numberText;
			lineNumberEl.style.cssText = `position:absolute;top:${layout.getVerticalOffsetForLineNumber(line)}px;left:0;width:${GUTTER_LINE_NUMBER_WIDTH}px;height:${lineHeight}px;line-height:${lineHeight}px;text-align:right;padding-right:8px;box-sizing:border-box;`;
			if (line === primaryActiveLine) {
				lineNumberEl.classList.add('dc-line-number-active');
			}
			this._lineNumbers.appendChild(lineNumberEl);
		}
	}
}
