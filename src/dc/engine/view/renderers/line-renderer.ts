/**
 * Dardcor Code - DOM Line Renderer with Token Span Styling (Task 211)
 * Mirrors: vs/editor/browser/view/viewLayer.ts + lineDecorations.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $, clearNode } from '../../../core/dom/element';
import { IRenderContext } from '../../options/editor-options';
import { LineToken, LineTokens } from '../../model/line-tokens';

export class LineRenderer extends Disposable {
	private readonly _domNode: HTMLElement;

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-view-lines');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		const { layout, viewport, viewModel, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const contentLeft = options.padding ? options.padding.top : 0;

		for (let line = viewport.startLineNumber; line <= viewport.endLineNumber; line++) {
			const content = viewModel.getLineContent(line);
			const tokens = ctx.getLineTokens ? ctx.getLineTokens(line) : null;
			const lineEl = $<HTMLElement>('div', 'dc-view-line');
			lineEl.style.cssText = `position:absolute;left:0;right:0;height:${lineHeight}px;line-height:${lineHeight}px;top:${layout.getVerticalOffsetForLineNumber(line) + contentLeft}px;white-space:pre;`;

			if (tokens && tokens.getCount() > 0) {
				this._renderTokenized(lineEl, content, tokens);
			} else {
				lineEl.textContent = content;
			}
			this._domNode.appendChild(lineEl);
		}
	}

	private _renderTokenized(container: HTMLElement, content: string, tokens: LineTokens): void {
		let lastEnd = 0;
		const count = tokens.getCount();
		for (let i = 0; i < count; i++) {
			const token = tokens.getToken(i);
			if (!token) {
				continue;
			}
			const start = Math.max(lastEnd, token.startOffset);
			const end = Math.min(content.length, token.endOffset);
			if (end <= start) {
				continue;
			}
			if (start > lastEnd) {
				container.appendChild(this._createTextSpan(content.substring(lastEnd, start), ''));
			}
			container.appendChild(this._createTextSpan(content.substring(start, end), this._classNameForToken(token)));
			lastEnd = end;
		}
		if (lastEnd < content.length) {
			container.appendChild(this._createTextSpan(content.substring(lastEnd), ''));
		}
	}

	private _createTextSpan(text: string, className: string): HTMLElement {
		const span = $<HTMLElement>('span', className);
		span.textContent = text;
		return span;
	}

	private _classNameForToken(token: LineToken): string {
		const type = token.type.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
		return `dc-token ${type ? 'dc-token-' + type : ''}`;
	}
}
