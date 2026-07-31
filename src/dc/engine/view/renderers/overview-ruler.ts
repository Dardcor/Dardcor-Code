import { Disposable } from '../../core/lifecycle/disposable.js';
import { $ } from '../../core/dom/element.js';

export const OVERVIEW_RULER_WIDTH = 14;
export const OVERVIEW_RULER_MAX_BARS = 1000;

export interface IOverviewRulerBar {
	readonly color: string;
	readonly lineNumber: number;
	readonly heightRatio?: number;
}

export class OverviewRuler extends Disposable {
	private readonly _canvas: HTMLCanvasElement;
	private readonly _ctx: CanvasRenderingContext2D | null;
	private readonly _bars: IOverviewRulerBar[] = [];
	private _lineCount = 1;
	private _viewHeight = 100;

	constructor(container: HTMLElement) {
		super();
		this._canvas = $<HTMLCanvasElement>('canvas', 'dc-overview-ruler');
		this._canvas.style.cssText = `position:absolute;top:0;right:0;bottom:0;width:${OVERVIEW_RULER_WIDTH}px;z-index:20;pointer-events:none;`;
		this._ctx = this._canvas.getContext('2d');
		container.appendChild(this._canvas);
		this._resize();
		this._draw();
	}

	public setLineCount(lineCount: number): void {
		this._lineCount = Math.max(1, lineCount);
		this._draw();
	}

	public setViewHeight(viewHeight: number): void {
		this._viewHeight = Math.max(1, viewHeight);
		this._resize();
	}

	public addBar(bar: IOverviewRulerBar): void {
		this._bars.push(bar);
		this._draw();
	}

	public removeBar(color: string, lineNumber: number): boolean {
		const index = this._bars.findIndex(b => b.color === color && b.lineNumber === lineNumber);
		if (index < 0) {
			return false;
		}
		this._bars.splice(index, 1);
		this._draw();
		return true;
	}

	public clearBars(): void {
		if (this._bars.length === 0) {
			return;
		}
		this._bars.length = 0;
		this._draw();
	}

	public getBarCount(): number {
		return this._bars.length;
	}

	public getCanvas(): HTMLCanvasElement {
		return this._canvas;
	}

	public updateScroll(scrollTop: number, viewHeight: number, scrollHeight: number): void {
		const canvasHeight = this._canvas.height;
		if (scrollHeight <= viewHeight || canvasHeight <= 0) {
			return;
		}
		const viewTop = (scrollTop / scrollHeight) * canvasHeight;
		const viewBottom = ((scrollTop + viewHeight) / scrollHeight) * canvasHeight;
		if (this._ctx) {
			this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
			this._ctx.fillStyle = 'rgba(128,128,128,0.35)';
			this._ctx.fillRect(0, viewTop, OVERVIEW_RULER_WIDTH, Math.max(2, viewBottom - viewTop));
			for (const bar of this._bars) {
				const y = ((bar.lineNumber - 0.5) / this._lineCount) * canvasHeight;
				if (y >= viewTop - 4 && y <= viewBottom + 4) {
					this._ctx.fillStyle = bar.color;
					this._ctx.fillRect(0, y, OVERVIEW_RULER_WIDTH, 1);
				}
			}
		}
	}

	private _resize(): void {
		this._canvas.width = OVERVIEW_RULER_WIDTH;
		this._canvas.height = Math.max(1, Math.min(OVERVIEW_RULER_MAX_BARS, this._viewHeight));
	}

	private _draw(): void {
		if (!this._ctx) {
			return;
		}
		this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		for (const bar of this._bars) {
			const y = ((bar.lineNumber - 0.5) / this._lineCount) * this._canvas.height;
			this._ctx.fillStyle = bar.color;
			this._ctx.fillRect(0, y, OVERVIEW_RULER_WIDTH, 1);
		}
	}

	override dispose(): void {
		this._canvas.remove();
		super.dispose();
	}
}
