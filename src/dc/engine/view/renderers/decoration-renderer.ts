/**
 * Dardcor Code - Inline & Margin Line Decoration Layer (Task 213)
 * Mirrors: vs/editor/browser/view/viewLayer.ts (line decorations)
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $, clearNode } from '../../../core/dom/element';
import { IRenderContext } from '../../options/editor-options';
import { IDecorationInterval } from '../../model/range-map';
import { Range } from '../../model/text-model';

export interface IDecorationProvider {
	getDecorationsInRange(range: Range): IDecorationInterval[];
}

export class DecorationRenderer extends Disposable {
	private readonly _domNode: HTMLElement;

	constructor(
		private readonly _provider: IDecorationProvider | null = null
	) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-decorations');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		if (!this._provider) {
			return;
		}

		const { layout, viewport, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const charWidth = ctx.charWidth;
		const visibleRange = new Range(viewport.startLineNumber, 1, viewport.endLineNumber, Number.MAX_SAFE_INTEGER);
		const decorations = this._provider.getDecorationsInRange(visibleRange);

		for (const dec of decorations) {
			const startLine = Math.max(viewport.startLineNumber, dec.range.startLineNumber);
			const endLine = Math.min(viewport.endLineNumber, dec.range.endLineNumber);
			for (let line = startLine; line <= endLine; line++) {
				const isStartLine = line === dec.range.startLineNumber;
				const isEndLine = line === dec.range.endLineNumber;
				const leftCol = isStartLine ? dec.range.startColumn : 1;
				const rightCol = isEndLine ? dec.range.endColumn : -1;

				const el = $<HTMLElement>('div', 'dc-decoration');
				if (dec.options.className) {
					el.classList.add(String(dec.options.className));
				}
				const top = layout.getVerticalOffsetForLineNumber(line);
				el.style.cssText = `position:absolute;top:${top}px;height:${lineHeight}px;left:${(leftCol - 1) * charWidth}px;right:${rightCol === -1 ? 0 : 'auto'};width:${rightCol === -1 ? 'auto' : Math.max(2, (rightCol - leftCol) * charWidth) + 'px'};`;
				this._domNode.appendChild(el);
			}
		}
	}
}
