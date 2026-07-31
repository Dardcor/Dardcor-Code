import { Disposable } from '../../../core/lifecycle/disposable';
import { $ } from '../../../core/dom/element';

export interface IGlyphCell {
	readonly id: string;
	readonly lineNumber: number;
	readonly className: string;
	readonly glyph: string;
}

export const GLYPH_MARGIN_WIDTH = 32;
export const GLYPH_MARGIN_CELL_SIZE = 16;

export class GlyphMargin extends Disposable {
	private readonly _margin: HTMLDivElement;
	private readonly _cells = new Map<string, HTMLSpanElement>();
	private readonly _lineHeight: number;

	constructor(container: HTMLElement, lineHeight: number = 19) {
		super();
		this._lineHeight = Math.max(1, lineHeight);
		this._margin = $<HTMLDivElement>('div', 'dc-glyph-margin');
		this._margin.style.cssText = `position:absolute;top:0;left:0;width:${GLYPH_MARGIN_WIDTH}px;bottom:0;overflow:hidden;z-index:10;user-select:none;`;
		container.appendChild(this._margin);
	}

	public addCell(cell: IGlyphCell): void {
		let span = this._cells.get(cell.id);
		if (!span) {
			span = $<HTMLSpanElement>('span', cell.className);
			span.style.position = 'absolute';
			span.style.left = '0';
			span.style.width = `${GLYPH_MARGIN_WIDTH}px`;
			span.style.textAlign = 'center';
			span.style.lineHeight = `${this._lineHeight}px`;
			this._cells.set(cell.id, span);
			this._margin.appendChild(span);
		}
		span.className = cell.className || 'dc-glyph';
		span.textContent = cell.glyph || '';
		span.style.top = `${(cell.lineNumber - 1) * this._lineHeight}px`;
		span.style.height = `${this._lineHeight}px`;
	}

	public moveCell(id: string, lineNumber: number): void {
		const span = this._cells.get(id);
		if (span) {
			span.style.top = `${(lineNumber - 1) * this._lineHeight}px`;
		}
	}

	public removeCell(id: string): boolean {
		const span = this._cells.get(id);
		if (!span) {
			return false;
		}
		span.remove();
		return this._cells.delete(id);
	}

	public hasCell(id: string): boolean {
		return this._cells.has(id);
	}

	public getCellCount(): number {
		return this._cells.size;
	}

	public getCellIds(): string[] {
		return Array.from(this._cells.keys());
	}

	public clear(): void {
		for (const span of this._cells.values()) {
			span.remove();
		}
		this._cells.clear();
	}

	public getDomNode(): HTMLDivElement {
		return this._margin;
	}

	override dispose(): void {
		this.clear();
		this._margin.remove();
		super.dispose();
	}
}
