import { Disposable } from '../../core/lifecycle/disposable.js';
import { $, addDisposableListener } from '../../core/dom/element.js';

export interface IScrollbarState {
	scrollTop: number;
	scrollHeight: number;
	viewHeight: number;
}

export class ScrollbarViewPart extends Disposable {
	private readonly _scrollbar: HTMLDivElement;
	private readonly _thumb: HTMLDivElement;
	private readonly _width: number;
	private readonly _minThumbSize: number;
	private _visible = true;

	public readonly scrollState: IScrollbarState = { scrollTop: 0, scrollHeight: 0, viewHeight: 0 };

	constructor(
		container: HTMLElement,
		width: number = 10,
		minThumbSize: number = 20
	) {
		super();
		this._width = Math.max(4, width);
		this._minThumbSize = Math.max(8, minThumbSize);
		this._scrollbar = $<HTMLDivElement>('div', 'dc-scrollbar');
		this._scrollbar.style.cssText = `position:absolute;top:0;right:0;bottom:0;width:${this._width}px;background:rgba(0,0,0,0.25);z-index:30;user-select:none;`;
		this._thumb = $<HTMLDivElement>('div', 'dc-scrollbar-thumb');
		this._thumb.style.cssText = 'position:absolute;left:2px;right:2px;border-radius:4px;background:rgba(121,121,121,0.6);';
		this._scrollbar.appendChild(this._thumb);
		container.appendChild(this._scrollbar);
		this._register(addDisposableListener(this._scrollbar, 'mousedown', (e: MouseEvent) => this._handleMouseDown(e)));
		this._register(addDisposableListener(window, 'mousemove', (e: MouseEvent) => this._handleMouseMove(e)));
		this._register(addDisposableListener(window, 'mouseup', () => this._stopDrag()));
		this._render();
	}

	public layout(scrollHeight: number, viewHeight: number): void {
		this.scrollState.scrollHeight = Math.max(0, scrollHeight);
		this.scrollState.viewHeight = Math.max(0, viewHeight);
		this._render();
	}

	public update(scrollTop: number): void {
		this.scrollState.scrollTop = Math.max(0, scrollTop);
		this._render();
	}

	public setScrollState(state: Partial<IScrollbarState>): void {
		if (state.scrollTop !== undefined) {
			this.scrollState.scrollTop = Math.max(0, state.scrollTop);
		}
		if (state.scrollHeight !== undefined) {
			this.scrollState.scrollHeight = Math.max(0, state.scrollHeight);
		}
		if (state.viewHeight !== undefined) {
			this.scrollState.viewHeight = Math.max(0, state.viewHeight);
		}
		this._render();
	}

	public getDomNode(): HTMLDivElement {
		return this._scrollbar;
	}

	public getThumbSize(): number {
		const { scrollHeight, viewHeight } = this.scrollState;
		if (scrollHeight <= viewHeight) {
			return 0;
		}
		return Math.max(this._minThumbSize, (viewHeight * viewHeight) / scrollHeight);
	}

	public getThumbTop(): number {
		const { scrollTop, scrollHeight, viewHeight } = this.scrollState;
		const thumbSize = this.getThumbSize();
		if (thumbSize === 0) {
			return 0;
		}
		return (scrollTop * (viewHeight - thumbSize)) / (scrollHeight - viewHeight);
	}

	public isVisible(): boolean {
		return this._visible;
	}

	public setVisible(visible: boolean): void {
		this._visible = visible;
		this._scrollbar.style.display = visible ? '' : 'none';
	}

	public scrollToPosition(top: number): void {
		this.update(top);
	}

	private _dragging = false;
	private _dragStartY = 0;
	private _dragStartTop = 0;

	private _handleMouseDown(e: MouseEvent): void {
		if (this.scrollState.scrollHeight <= this.scrollState.viewHeight) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const rect = this._scrollbar.getBoundingClientRect();
		const clickY = e.clientY - rect.top;
		const thumbTop = this.getThumbTop();
		const thumbSize = this.getThumbSize();
		if (clickY >= thumbTop && clickY <= thumbTop + thumbSize) {
			this._dragging = true;
			this._dragStartY = e.clientY;
			this._dragStartTop = thumbTop;
			return;
		}
		const scrollHeight = this.scrollState.scrollHeight;
		const viewHeight = this.scrollState.viewHeight;
		const ratio = (clickY - thumbSize / 2) / (viewHeight - thumbSize);
		this.scrollState.scrollTop = Math.max(0, Math.min(scrollHeight - viewHeight, ratio * (scrollHeight - viewHeight)));
		this._render();
	}

	private _handleMouseMove(e: MouseEvent): void {
		if (!this._dragging) {
			return;
		}
		const dy = e.clientY - this._dragStartY;
		const thumbSize = this.getThumbSize();
		const track = Math.max(1, this.scrollState.viewHeight - thumbSize);
		const deltaTop = (dy * (this.scrollState.scrollHeight - this.scrollState.viewHeight)) / track;
		this.scrollState.scrollTop = Math.max(0, this.scrollState.scrollHeight - this.scrollState.viewHeight > 0
			? Math.min(this.scrollState.scrollHeight - this.scrollState.viewHeight, this._dragStartTop + deltaTop)
			: 0);
		this._render();
	}

	private _stopDrag(): void {
		this._dragging = false;
	}

	private _render(): void {
		const { scrollHeight, viewHeight } = this.scrollState;
		if (scrollHeight <= viewHeight || viewHeight <= 0) {
			this._thumb.style.display = 'none';
			return;
		}
		this._thumb.style.display = '';
		this._thumb.style.height = `${this.getThumbSize()}px`;
		this._thumb.style.top = `${this.getThumbTop()}px`;
	}
}
