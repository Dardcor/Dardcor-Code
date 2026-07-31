/**
 * Dardcor Code - Vertical Column Ruler Lines (Task 235)
 * Mirrors: vs/editor/browser/viewParts/rulers/rulers.ts
 */

import { $ } from '../../../core/dom/element.js';
import { Disposable } from '../../../core/lifecycle/disposable.js';

export interface IRulerRenderOptions {
	readonly charWidth: number;
	readonly lineHeight: number;
	readonly color: string;
	readonly verticalLines: readonly number[];
}

export class RulerRenderer extends Disposable {
	private readonly _domNode: HTMLElement;
	private _rulers: number[] = [];
	private _charWidth: number;
	private _lineHeight: number;
	private _color: string;
	private _scrollLeft = 0;
	private _width = 0;
	private _height = 0;

	constructor(container: HTMLElement, options: Partial<IRulerRenderOptions> = {}) {
		super();
		this._domNode = $<HTMLElement>('div', 'dc-rulers');
		this._domNode.style.cssText = 'position:absolute;top:0;left:0;overflow:hidden;pointer-events:none;';
		container.appendChild(this._domNode);
		this._charWidth = options.charWidth ?? 7.5;
		this._lineHeight = options.lineHeight ?? 19;
		this._color = options.color ?? '#2a2a2a';
		this._rulers = [...(options.verticalLines ?? [])];
	}

	public setRulers(rulers: readonly number[]): void {
		this._rulers = [...rulers].filter((col) => col > 0);
		this._render();
	}

	public setCharWidth(charWidth: number): void {
		this._charWidth = Math.max(1, charWidth);
		this._render();
	}

	public setColor(color: string): void {
		this._color = color;
		this._render();
	}

	public setDimensions(width: number, height: number): void {
		this._width = Math.max(0, width);
		this._height = Math.max(0, height);
		this._domNode.style.width = `${this._width}px`;
		this._domNode.style.height = `${this._height}px`;
		this._render();
	}

	public setScrollLeft(scrollLeft: number): void {
		this._scrollLeft = Math.max(0, scrollLeft);
		this._render();
	}

	public render(scrollLeft: number, width: number, height: number): void {
		this._scrollLeft = scrollLeft;
		this.setDimensions(width, height);
	}

	private _render(): void {
		this._domNode.innerHTML = '';
		for (const column of this._rulers) {
			const x = column * this._charWidth - this._scrollLeft;
			if (x < 0 || x >= this._width) {
				continue;
			}
			const ruler = $<HTMLElement>('div', 'dc-ruler');
			ruler.style.cssText = `position:absolute;top:0;left:${x}px;width:1px;height:${this._height}px;background:${this._color};`;
			this._domNode.appendChild(ruler);
		}
	}

	public getRulers(): number[] {
		return [...this._rulers];
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
