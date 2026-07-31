/**
 * Dardcor Code - View Line Array Virtualizer (Task 242)
 * Mirrors: vs/editor/browser/view/viewLines/viewLines.ts
 */

import { $ } from '../../core/dom/element';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { LineTokens } from '../model/line-tokens';

export interface IViewLineData {
	readonly lineNumber: number;
	readonly content: string;
	readonly tokens: LineTokens | null;
}

export interface IViewLinesOptions {
	readonly lineHeight: number;
	readonly renderBufferLines: number;
}

export class ViewLines extends Disposable {
	private readonly _linesDom: HTMLElement;
	private readonly _lineElements = new Map<number, HTMLElement>();
	private readonly _lineData = new Map<number, IViewLineData>();
	private readonly _pool: HTMLElement[] = [];

	private _scrollTop = 0;
	private _startLineNumber = 1;
	private _endLineNumber = 0;
	private _lineHeight: number;
	private _renderBufferLines: number;

	private readonly _onDidRenderLines = this._register(new Emitter<{ startLineNumber: number; endLineNumber: number }>());
	readonly onDidRenderLines: Event<{ startLineNumber: number; endLineNumber: number }> = this._onDidRenderLines.event;

	constructor(container: HTMLElement, options: IViewLinesOptions) {
		super();
		this._linesDom = $<HTMLElement>('div', 'dc-view-lines');
		container.appendChild(this._linesDom);
		this._lineHeight = options.lineHeight;
		this._renderBufferLines = Math.max(0, options.renderBufferLines);
	}

	public setLineData(data: IViewLineData[]): void {
		for (const entry of data) {
			this._lineData.set(entry.lineNumber, entry);
		}
	}

	public removeLineData(lineNumber: number): void {
		this._lineData.delete(lineNumber);
	}

	public clearLineData(): void {
		this._lineData.clear();
	}

	public setLineHeight(lineHeight: number): void {
		this._lineHeight = Math.max(1, lineHeight);
	}

	public setScrollTop(scrollTop: number): void {
		this._scrollTop = Math.max(0, scrollTop);
		this._render();
	}

	public getScrollTop(): number {
		return this._scrollTop;
	}

	public render(visibleLineCount: number, totalLineCount: number): void {
		const start = Math.max(1, Math.floor(this._scrollTop / this._lineHeight) + 1 - this._renderBufferLines);
		const end = Math.min(totalLineCount, start + visibleLineCount + this._renderBufferLines * 2 - 1);
		this._startLineNumber = start;
		this._endLineNumber = end;
		this._render();
	}

	private _render(): void {
		const topLine = Math.max(1, Math.floor(this._scrollTop / this._lineHeight));
		const visibleCount = Math.max(1, Math.ceil(this._linesDom.clientHeight / this._lineHeight)) + 1;
		const start = Math.max(1, topLine);
		const end = Math.min(this._endLineNumber, start + visibleCount - 1);

		for (const [lineNumber, element] of this._lineElements) {
			if (lineNumber < start || lineNumber > end) {
				this._recycleElement(lineNumber, element);
			}
		}

		for (let lineNumber = start; lineNumber <= end; lineNumber++) {
			const data = this._lineData.get(lineNumber);
			if (!data) {
				continue;
			}
			let element = this._lineElements.get(lineNumber);
			if (!element) {
				element = this._pool.pop() ?? $<HTMLElement>('div', 'dc-view-line');
				element.style.height = `${this._lineHeight}px`;
				this._linesDom.appendChild(element);
				this._lineElements.set(lineNumber, element);
			}
			const top = (lineNumber - 1) * this._lineHeight - this._scrollTop;
			element.style.top = `${top}px`;
			element.textContent = data.content;
		}

		this._onDidRenderLines.fire({ startLineNumber: start, endLineNumber: end });
	}

	private _recycleElement(lineNumber: number, element: HTMLElement): void {
		this._lineElements.delete(lineNumber);
		element.remove();
		this._pool.push(element);
	}

	public getLineDomNode(lineNumber: number): HTMLElement | undefined {
		return this._lineElements.get(lineNumber);
	}

	public getRenderedStartLine(): number {
		return this._startLineNumber;
	}

	public getRenderedEndLine(): number {
		return this._endLineNumber;
	}

	public getDomNode(): HTMLElement {
		return this._linesDom;
	}

	public override dispose(): void {
		this._lineElements.clear();
		this._lineData.clear();
		this._pool.length = 0;
		this._linesDom.remove();
		super.dispose();
	}
}
