/**
 * Dardcor Code - Highlighted Text Selection Block Layer (Task 215)
 * Mirrors: vs/editor/browser/viewParts/selection/selection.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $, clearNode } from '../../../core/dom/element';
import { IRenderContext } from '../../options/editor-options';
import { CursorSelection } from '../../cursor/cursor-operations';
import { Position, Range } from '../../model/text-model';

export class SelectionRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private _selections: CursorSelection[] = [];

	constructor() {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-selections');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;right:0;pointer-events:none;';
	}

	getDomNode(): HTMLElement {
		return this._domNode;
	}

	setSelections(selections: CursorSelection[]): void {
		this._selections = selections;
	}

	render(ctx: IRenderContext): void {
		clearNode(this._domNode);
		const { layout, viewport, viewModel, options } = ctx;
		const lineHeight = options.lineHeight > 0 ? options.lineHeight : Math.round(options.fontSize * 1.5);
		const charWidth = ctx.charWidth;

		for (const sel of this._selections) {
			if (!sel.isSelection) {
				continue;
			}
			const start = sel.start;
			const end = sel.end;
			const startLine = Math.max(viewport.startLineNumber, start.lineNumber);
			const endLine = Math.min(viewport.endLineNumber, end.lineNumber);
			if (startLine > endLine) {
				continue;
			}
			for (let line = startLine; line <= endLine; line++) {
				const lineLength = viewModel.getLineContent(line).length;
				const leftCol = line === start.lineNumber ? start.column : 1;
				const rightCol = line === end.lineNumber ? Math.min(end.column, lineLength + 1) : lineLength + 1;
				if (rightCol <= leftCol) {
					continue;
				}
				const el = $<HTMLElement>('div', 'dc-selection');
				const left = (leftCol - 1) * charWidth;
				const width = (rightCol - leftCol) * charWidth;
				el.style.cssText = `position:absolute;top:${layout.getVerticalOffsetForLineNumber(line)}px;height:${lineHeight}px;left:${left}px;width:${Math.max(1, width)}px;`;
				this._domNode.appendChild(el);
			}
		}
	}
}
