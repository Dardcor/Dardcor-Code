/**
 * Dardcor Code - Mouse Drag Selection Auto-Scroll Controller (Task 252)
 * Mirrors: vs/editor/browser/controller/mouseController.ts (drag auto-scroll)
 */

import { addDisposableListener } from '../../core/dom/element';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export interface IDragSelectionCallbacks {
	getPositionFromPoint(x: number, y: number): { lineNumber: number; column: number } | null;
	setSelection(lineNumber: number, column: number): void;
	scrollBy(dx: number, dy: number): void;
	getViewportRect(): { left: number; top: number; width: number; height: number };
	getScrollableSize(): { width: number; height: number };
}

export interface IDragSelectionOptions {
	readonly autoScrollEdge: number;
	readonly autoScrollInterval: number;
	readonly autoScrollSpeed: number;
}

const DEFAULT_OPTIONS: IDragSelectionOptions = {
	autoScrollEdge: 20,
	autoScrollInterval: 50,
	autoScrollSpeed: 3,
};

export class DragSelectionController extends Disposable {
	private _isDragging = false;
	private _lastX = 0;
	private _lastY = 0;
	private _timer: ReturnType<typeof setInterval> | null = null;
	private _options: IDragSelectionOptions;

	private readonly _onDidAutoScroll = this._register(new Emitter<{ dx: number; dy: number }>());
	readonly onDidAutoScroll: Event<{ dx: number; dy: number }> = this._onDidAutoScroll.event;

	constructor(
		element: HTMLElement,
		private readonly _callbacks: IDragSelectionCallbacks,
		options: Partial<IDragSelectionOptions> = {}
	) {
		super();
		this._options = { ...DEFAULT_OPTIONS, ...options };
		this._register(addDisposableListener(element, 'mousedown', (e: MouseEvent) => this._onMouseDown(e)));
		this._register(addDisposableListener(element, 'mousemove', (e: MouseEvent) => this._onMouseMove(e)));
		this._register(addDisposableListener(window, 'mouseup', (e: MouseEvent) => this._onMouseUp(e)));
	}

	public beginDrag(x: number, y: number): boolean {
		const position = this._callbacks.getPositionFromPoint(x, y);
		if (!position) {
			return false;
		}
		this._isDragging = true;
		this._lastX = x;
		this._lastY = y;
		this._callbacks.setSelection(position.lineNumber, position.column);
		this._startAutoScrollTimer();
		return true;
	}

	public moveTo(x: number, y: number): void {
		if (!this._isDragging) {
			return;
		}
		this._lastX = x;
		this._lastY = y;
		const position = this._callbacks.getPositionFromPoint(x, y);
		if (position) {
			this._callbacks.setSelection(position.lineNumber, position.column);
		}
	}

	public endDrag(): void {
		this._isDragging = false;
		this._stopAutoScrollTimer();
	}

	public isDragging(): boolean {
		return this._isDragging;
	}

	private _onMouseDown(event: MouseEvent): void {
		if (event.button !== 0) {
			return;
		}
		this.beginDrag(event.clientX, event.clientY);
	}

	private _onMouseMove(event: MouseEvent): void {
		this.moveTo(event.clientX, event.clientY);
	}

	private _onMouseUp(_event: MouseEvent): void {
		this.endDrag();
	}

	private _startAutoScrollTimer(): void {
		this._stopAutoScrollTimer();
		this._timer = setInterval(() => this._autoScrollTick(), this._options.autoScrollInterval);
	}

	private _stopAutoScrollTimer(): void {
		if (this._timer !== null) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}

	private _autoScrollTick(): void {
		if (!this._isDragging) {
			return;
		}
		const rect = this._callbacks.getViewportRect();
		const scrollable = this._callbacks.getScrollableSize();
		let dx = 0;
		let dy = 0;
		const edge = this._options.autoScrollEdge;
		const speed = this._options.autoScrollSpeed;

		if (this._lastY < rect.top + edge && this._lastY >= rect.top) {
			dy = -speed;
		} else if (this._lastY > rect.top + rect.height - edge && this._lastY <= rect.top + rect.height) {
			dy = speed;
		}
		if (this._lastX < rect.left + edge && this._lastX >= rect.left) {
			dx = -speed;
		} else if (this._lastX > rect.left + rect.width - edge && this._lastX <= rect.left + rect.width) {
			dx = speed;
		}

		if (dx !== 0 || dy !== 0) {
			this._callbacks.scrollBy(dx, dy);
			this._onDidAutoScroll.fire({ dx, dy });
			const scrolledX = this._lastX + dx;
			const scrolledY = this._lastY + dy;
			if (scrolledX >= 0 && scrolledY >= 0 && scrolledX <= scrollable.width && scrolledY <= scrollable.height) {
				this.moveTo(scrolledX, scrolledY);
			}
		}
	}

	public override dispose(): void {
		this._stopAutoScrollTimer();
		this._isDragging = false;
		super.dispose();
	}
}
