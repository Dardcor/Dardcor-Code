/**
 * Dardcor Code - Active Line Background Highlight Renderer (Task 243)
 * Mirrors: vs/editor/browser/viewParts/currentLineHighlight/currentLineHighlight.ts
 */

import { $ } from '../../../core/dom/element';
import { Disposable } from '../../../core/lifecycle/disposable';

export interface ICurrentLineRenderOptions {
	readonly color: string;
	readonly borderColor: string;
	readonly lineHeight: number;
}

export class CurrentLineRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private _lineNumber = 0;
	private _color: string;
	private _borderColor: string;
	private _lineHeight: number;
	private _scrollTop = 0;
	private _width = 0;

	constructor(container: HTMLElement, options: Partial<ICurrentLineRenderOptions> = {}) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-current-line');
		this._domNode.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none;display:none;';
		container.appendChild(this._domNode);
		this._color = options.color ?? 'rgba(255,255,255,0.06)';
		this._borderColor = options.borderColor ?? 'rgba(255,255,255,0.08)';
		this._lineHeight = options.lineHeight ?? 19;
	}

	public setLine(lineNumber: number): void {
		this._lineNumber = Math.max(0, lineNumber);
		this._render();
	}

	public getLine(): number {
		return this._lineNumber;
	}

	public hide(): void {
		this._lineNumber = 0;
		this._domNode.style.display = 'none';
	}

	public setScrollTop(scrollTop: number): void {
		this._scrollTop = Math.max(0, scrollTop);
		this._render();
	}

	public setWidth(width: number): void {
		this._width = Math.max(0, width);
		this._render();
	}

	public setLineHeight(lineHeight: number): void {
		this._lineHeight = Math.max(1, lineHeight);
		this._render();
	}

	public render(scrollTop: number, lineNumber: number): void {
		this._scrollTop = Math.max(0, scrollTop);
		this._lineNumber = lineNumber;
		this._render();
	}

	private _render(): void {
		if (this._lineNumber <= 0) {
			this._domNode.style.display = 'none';
			return;
		}
		const top = (this._lineNumber - 1) * this._lineHeight - this._scrollTop;
		this._domNode.style.display = 'block';
		this._domNode.style.top = `${top}px`;
		this._domNode.style.height = `${this._lineHeight}px`;
		this._domNode.style.width = this._width > 0 ? `${this._width}px` : '100%';
		this._domNode.style.background = this._color;
		this._domNode.style.borderTop = `1px solid ${this._borderColor}`;
		this._domNode.style.borderBottom = `1px solid ${this._borderColor}`;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
