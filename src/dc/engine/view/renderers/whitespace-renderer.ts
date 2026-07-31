/**
 * Dardcor Code - Whitespace Symbol Glyph Layer (Task 216)
 * Mirrors: vs/editor/browser/viewParts/whitespace/whitespace.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { IRenderContext } from '../../options/editor-options.js';

const SPACE_GLYPH = '\u00B7';
const TAB_GLYPH = '\u2192';

export class WhitespaceRenderer extends Disposable {
	private readonly _domNode: HTMLElement;

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-whitespace');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		const mode = ctx.options.renderWhitespace;
		if (mode === 'none') {
			return;
		}

		const { layout, viewport, viewModel, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const charWidth = ctx.charWidth;
		const tabSize = options.tabSize;

		for (let line = viewport.startLineNumber; line <= viewport.endLineNumber; line++) {
			const content = viewModel.getLineContent(line);
			let col = 1;
			let inBoundary = true;
			for (let i = 0; i < content.length; i++) {
				const ch = content.charAt(i);
				if (mode === 'boundary' && !inBoundary) {
					break;
				}
				if (ch === ' ') {
					this._appendGlyph(ctx, line, col, SPACE_GLYPH, charWidth, lineHeight, layout);
					col++;
				} else if (ch === '\t') {
					const width = (tabSize - ((col - 1) % tabSize)) * charWidth;
					this._appendGlyph(ctx, line, col, TAB_GLYPH, width, lineHeight, layout);
					col += tabSize - ((col - 1) % tabSize);
				} else {
					if (ch !== ' ' && ch !== '\t') {
						inBoundary = false;
					}
					col++;
				}
			}
		}
	}

	private _appendGlyph(ctx: IRenderContext, lineNumber: number, column: number, glyph: string, width: number, lineHeight: number, layout: { getVerticalOffsetForLineNumber(lineNumber: number): number }): void {
		const el = $<HTMLElement>('span', 'dc-whitespace-glyph');
		el.textContent = glyph;
		el.style.cssText = `position:absolute;top:${layout.getVerticalOffsetForLineNumber(lineNumber)}px;left:${(column - 1) * ctx.charWidth}px;width:${width}px;height:${lineHeight}px;line-height:${lineHeight}px;`;
		this._domNode.appendChild(el);
	}
}
