import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export interface IDecorationCell {
	readonly top: number;
	readonly left: number;
	readonly width: number;
	readonly height: number;
	readonly className: string;
}

export class ViewPartDecorations extends Disposable {
	private readonly _layer: HTMLDivElement;
	private readonly _spans = new Map<string, HTMLSpanElement>();

	constructor(container: HTMLElement) {
		super();
		this._layer = $<HTMLDivElement>('div', 'dc-view-part-decorations');
		this._layer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;overflow:hidden;z-index:5;';
		container.appendChild(this._layer);
	}

	public addDecoration(id: string, top: number, left: number, width: number, height: number, className: string): void {
		let span = this._spans.get(id);
		if (!span) {
			span = $<HTMLSpanElement>('span', className);
			span.style.position = 'absolute';
			this._spans.set(id, span);
			this._layer.appendChild(span);
		}
		span.className = className || 'dc-decoration';
		span.style.top = `${top}px`;
		span.style.left = `${left}px`;
		span.style.width = `${width}px`;
		span.style.height = `${height}px`;
	}

	public moveDecoration(id: string, top: number, left: number): void {
		const span = this._spans.get(id);
		if (span) {
			span.style.top = `${top}px`;
			span.style.left = `${left}px`;
		}
	}

	public resizeDecoration(id: string, width: number, height: number): void {
		const span = this._spans.get(id);
		if (span) {
			span.style.width = `${width}px`;
			span.style.height = `${height}px`;
		}
	}

	public removeDecoration(id: string): boolean {
		const span = this._spans.get(id);
		if (!span) {
			return false;
		}
		span.remove();
		return this._spans.delete(id);
	}

	public getDecoration(id: string): HTMLSpanElement | undefined {
		return this._spans.get(id);
	}

	public hasDecoration(id: string): boolean {
		return this._spans.has(id);
	}

	public getDecorationCount(): number {
		return this._spans.size;
	}

	public getDecorationIds(): string[] {
		return Array.from(this._spans.keys());
	}

	public clear(): void {
		for (const span of this._spans.values()) {
			span.remove();
		}
		this._spans.clear();
	}

	public getDomNode(): HTMLDivElement {
		return this._layer;
	}

	override dispose(): void {
		this.clear();
		this._layer.remove();
		super.dispose();
	}
}
