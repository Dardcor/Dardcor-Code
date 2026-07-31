import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export interface ILineTokenStyle {
	readonly className: string;
	readonly color?: string;
}

export interface IRenderedLineSegment {
	readonly text: string;
	readonly className?: string;
}

export interface ILineRenderingOptions {
	readonly tabSize?: number;
	readonly tabWidth?: number;
	readonly monospaceFont?: boolean;
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function expandTabs(text: string, tabSize: number): string {
	const tabSizeSafe = Math.max(1, tabSize);
	let result = '';
	let column = 0;
	for (const char of text) {
		if (char === '\t') {
			const spaces = tabSizeSafe - (column % tabSizeSafe);
			result += ' '.repeat(spaces);
			column += spaces;
		} else {
			result += char;
			column++;
		}
	}
	return result;
}

export function estimateTextWidth(text: string, charWidth: number): number {
	let width = 0;
	for (const char of text) {
		const code = char.codePointAt(0) ?? 0;
		if (code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a
			|| (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
			|| (code >= 0xac00 && code <= 0xd7a3)
			|| (code >= 0xf900 && code <= 0xfaff)
			|| (code >= 0xfe10 && code <= 0xfe19)
			|| (code >= 0xfe30 && code <= 0xfe6f)
			|| (code >= 0xff00 && code <= 0xff60)
			|| (code >= 0xffe0 && code <= 0xffe6)
			|| (code >= 0x20000 && code <= 0x2fffd))) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width * charWidth;
}

export class LineRendering extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _lineElements = new Map<number, HTMLDivElement>();
	private readonly _options: ILineRenderingOptions;

	constructor(container: HTMLElement, options: ILineRenderingOptions = {}) {
		super();
		this._container = container;
		this._options = options;
	}

	public renderLine(lineNumber: number, text: string, segments: IRenderedLineSegment[], lineHeight: number, top: number): HTMLDivElement {
		let el = this._lineElements.get(lineNumber);
		if (!el) {
			el = $<HTMLDivElement>('div', 'dc-view-line');
			el.style.position = 'absolute';
			el.style.left = '0';
			el.style.right = '0';
			el.style.whiteSpace = 'pre';
			this._lineElements.set(lineNumber, el);
			this._container.appendChild(el);
		}
		el.style.height = `${lineHeight}px`;
		el.style.top = `${top}px`;
		this._setLineContent(el, text, segments);
		return el;
	}

	public removeLine(lineNumber: number): boolean {
		const el = this._lineElements.get(lineNumber);
		if (!el) {
			return false;
		}
		el.remove();
		return this._lineElements.delete(lineNumber);
	}

	public hasLine(lineNumber: number): boolean {
		return this._lineElements.has(lineNumber);
	}

	public getLineElement(lineNumber: number): HTMLDivElement | undefined {
		return this._lineElements.get(lineNumber);
	}

	public getRenderedLineCount(): number {
		return this._lineElements.size;
	}

	public clear(): void {
		for (const el of this._lineElements.values()) {
			el.remove();
		}
		this._lineElements.clear();
	}

	public renderSegmentsToHtml(segments: IRenderedLineSegment[]): string {
		let html = '';
		for (const segment of segments) {
			const escaped = escapeHtml(segment.text);
			if (segment.className) {
				html += `<span class="${segment.className}">${escaped}</span>`;
			} else {
				html += escaped;
			}
		}
		return html;
	}

	public segmentsForText(text: string, styledRanges: ILineTokenStyle[]): IRenderedLineSegment[] {
		const tabSize = this._options.tabSize ?? 4;
		const expanded = expandTabs(text, tabSize);
		if (!styledRanges || styledRanges.length === 0) {
			return [{ text: expanded }];
		}
		const segments: IRenderedLineSegment[] = [];
		for (const style of styledRanges) {
			segments.push({ text: expanded, className: style.className });
		}
		return segments;
	}

	private _setLineContent(el: HTMLDivElement, text: string, segments: IRenderedLineSegment[]): void {
		if (!segments || segments.length === 0) {
			el.textContent = expandTabs(text, this._options.tabSize ?? 4);
			return;
		}
		el.innerHTML = this.renderSegmentsToHtml(segments);
	}
}
