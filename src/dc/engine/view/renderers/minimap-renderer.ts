/**
 * Dardcor Code - HTML5 Canvas Minimap Code Preview Layer (Task 234)
 * Mirrors: vs/editor/contrib/minimap/browser/minimap.ts
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { LineTokens } from '../../model/line-tokens.js';

export interface IMinimapRenderOptions {
	readonly width: number;
	readonly height: number;
	readonly scale: number;
	readonly backgroundColor: string;
	readonly defaultTokenColor: string;
	readonly tokenColors: Readonly<Record<string, string>>;
}

export interface IMinimapLineInput {
	readonly lineNumber: number;
	readonly content: string;
	readonly tokens: LineTokens | null;
}

const DEFAULT_TOKEN_COLORS: Record<string, string> = {
	keyword: '#569cd6',
	storage: '#569cd6',
	control: '#569cd6',
	string: '#ce9178',
	comment: '#6a9955',
	number: '#b5cea8',
	type: '#4ec9b0',
	function: '#dcdcaa',
	variable: '#9cdcfe',
	constant: '#569cd6',
	tag: '#569cd6',
	'': '#d4d4d4',
};

export class MinimapRenderer extends Disposable {
	private readonly _canvas: HTMLCanvasElement;
	private readonly _context: CanvasRenderingContext2D;
	private _options: IMinimapRenderOptions;
	private _scrollTop = 0;
	private _viewportHeight = 0;
	private _totalLineCount = 1;

	constructor(canvas: HTMLCanvasElement, options: Partial<IMinimapRenderOptions> = {}) {
		super();
		this._canvas = canvas;
		this._context = canvas.getContext('2d')!;
		this._options = {
			width: options.width ?? 60,
			height: options.height ?? 100,
			scale: options.scale ?? 2,
			backgroundColor: options.backgroundColor ?? '#1e1e1e',
			defaultTokenColor: options.defaultTokenColor ?? '#d4d4d4',
			tokenColors: options.tokenColors ?? DEFAULT_TOKEN_COLORS,
		};
		this._applySize();
	}

	public setOptions(options: Partial<IMinimapRenderOptions>): void {
		this._options = { ...this._options, ...options };
		this._applySize();
	}

	private _applySize(): void {
		this._canvas.width = Math.max(1, Math.floor(this._options.width));
		this._canvas.height = Math.max(1, Math.floor(this._options.height));
		this._canvas.style.width = `${this._options.width}px`;
		this._canvas.style.height = `${this._options.height}px`;
	}

	public setScrollTop(scrollTop: number): void {
		this._scrollTop = Math.max(0, scrollTop);
	}

	public setViewport(scrollTop: number, viewportHeight: number): void {
		this._scrollTop = Math.max(0, scrollTop);
		this._viewportHeight = Math.max(0, viewportHeight);
	}

	public getScrollTop(): number {
		return this._scrollTop;
	}

	public render(lines: readonly IMinimapLineInput[]): void {
		const { width, height, scale, backgroundColor } = this._options;
		const context = this._context;
		context.fillStyle = backgroundColor;
		context.fillRect(0, 0, width, height);

		for (const line of lines) {
			const y = Math.floor(line.lineNumber / scale);
			if (y < 0 || y >= height) {
				continue;
			}
			this._renderLinePixels(context, line, y);
		}
	}

	public renderAll(lineGetter: (lineNumber: number) => IMinimapLineInput): void {
		const { height, scale } = this._options;
		const startLine = Math.max(1, Math.floor(this._scrollTop / scale));
		const endLine = Math.min(this._totalLineCount, startLine + Math.ceil(height * scale));
		const inputs: IMinimapLineInput[] = [];
		for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
			inputs.push(lineGetter(lineNumber));
		}
		this.render(inputs);
	}

	private _renderLinePixels(context: CanvasRenderingContext2D, line: IMinimapLineInput, y: number): void {
		const { width, scale, defaultTokenColor, tokenColors } = this._options;
		const content = line.content;

		if (line.tokens && line.tokens.getCount() > 0) {
			for (let i = 0; i < line.tokens.getCount(); i++) {
				const token = line.tokens.getToken(i);
				if (!token) {
					continue;
				}
				const color = this._resolveColor(token.type, defaultTokenColor, tokenColors);
				const startX = Math.floor(token.startOffset / scale);
				const endX = Math.min(width, Math.ceil(token.endOffset / scale));
				context.fillStyle = color;
				context.fillRect(startX, y, Math.max(1, endX - startX), 1);
			}
		} else {
			const color = this._resolveColor('', defaultTokenColor, tokenColors);
			context.fillStyle = color;
			context.fillRect(0, y, Math.min(width, Math.max(1, Math.ceil(content.length / scale))), 1);
		}
	}

	private _resolveColor(scope: string, defaultColor: string, tokenColors: Readonly<Record<string, string>>): string {
		if (!scope) {
			return defaultColor;
		}
		if (tokenColors[scope]) {
			return tokenColors[scope];
		}
		const segments = scope.split('.');
		for (let i = segments.length - 1; i >= 0; i--) {
			const candidate = segments.slice(0, i + 1).join('.');
			if (tokenColors[candidate]) {
				return tokenColors[candidate];
			}
		}
		return defaultColor;
	}

	public setTotalLineCount(lineCount: number): void {
		this._totalLineCount = Math.max(1, lineCount);
	}

	public getTotalLineCount(): number {
		return this._totalLineCount;
	}
}
