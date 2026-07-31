/**
 * Dardcor Code - Vertical Indentation Guide Line Layer (Task 217)
 * Mirrors: vs/editor/browser/viewParts/indentGuides/indentGuide.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { $, clearNode } from '../../../core/dom/element.js';
import { IRenderContext } from '../../options/editor-options.js';

export class IndentGuideRenderer extends Disposable {
	private readonly _domNode: HTMLElement;

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-indent-guides');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		if (!ctx.options.renderIndentGuides) {
			return;
		}

		const { layout, viewport, viewModel, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const charWidth = ctx.charWidth;
		const tabSize = options.tabSize;

		for (let line = viewport.startLineNumber; line <= viewport.endLineNumber; line++) {
			const content = viewModel.getLineContent(line);
			let indentWidth = 0;
			for (let i = 0; i < content.length; i++) {
				const ch = content.charAt(i);
				if (ch === ' ') {
					indentWidth++;
				} else if (ch === '\t') {
					indentWidth += tabSize - (indentWidth % tabSize);
				} else {
					break;
				}
			}
			if (indentWidth <= 0) {
				continue;
			}
			const levels = Math.floor(indentWidth / tabSize);
			for (let level = 1; level <= levels; level++) {
				const el = $<HTMLElement>('div', 'dc-indent-guide');
				const x = level * tabSize * charWidth - charWidth;
				el.style.cssText = `position:absolute;top:${layout.getVerticalOffsetForLineNumber(line)}px;left:${x}px;width:1px;height:${lineHeight}px;`;
				this._domNode.appendChild(el);
			}
		}
	}
}
