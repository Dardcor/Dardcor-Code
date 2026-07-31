/**
 * Dardcor Code - Mouse Drag, Click & Selection Handler (Task 223)
 * Mirrors: vs/editor/browser/controller/mouseHandler.ts
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { addDisposableListener } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Position } from '../model/text-model.js';
import { ViewLayout } from '../view/view-layout.js';
import { EditorOptions } from '../options/editor-options.js';

export interface IMouseEventData {
	readonly position: Position;
	readonly event: MouseEvent;
	readonly clickCount: number;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
}

export interface IMouseDragData {
	readonly start: Position;
	readonly current: Position;
}

export class MouseInput extends Disposable {
	private _dragStart: Position | null = null;
	private _isDragging = false;
	private _dragDistance = 0;
	private _autoScrollFrame = 0;

	private readonly _onMouseDown = this._register(new Emitter<IMouseEventData>());
	readonly onMouseDown: Event<IMouseEventData> = this._onMouseDown.event;

	private readonly _onMouseUp = this._register(new Emitter<IMouseEventData>());
	readonly onMouseUp: Event<IMouseEventData> = this._onMouseUp.event;

	private readonly _onMouseMove = this._register(new Emitter<IMouseEventData>());
	readonly onMouseMove: Event<IMouseEventData> = this._onMouseMove.event;

	private readonly _onMouseDrag = this._register(new Emitter<IMouseDragData>());
	readonly onMouseDrag: Event<IMouseDragData> = this._onMouseDrag.event;

	private readonly _onMouseDragEnd = this._register(new Emitter<IMouseDragData>());
	readonly onMouseDragEnd: Event<IMouseDragData> = this._onMouseDragEnd.event;

	constructor(
		private readonly _container: HTMLElement,
		private readonly _layout: ViewLayout,
		private readonly _options: EditorOptions,
		private readonly _getLineCount: () => number,
		private readonly _getLineLength: (lineNumber: number) => number
	) {
		super();
		this._register(addDisposableListener(this._container, 'mousedown', e => this._handleMouseDown(e as MouseEvent)));
		this._register(addDisposableListener(this._container, 'mousemove', e => this._handleMouseMove(e as MouseEvent)));
		this._register(addDisposableListener(this._container, 'mouseup', e => this._handleMouseUp(e as MouseEvent)));
		this._register(addDisposableListener(this._container, 'mouseleave', () => this._cancelDrag()));
		this._register(addDisposableListener(this._container, 'contextmenu', e => e.preventDefault()));
	}

	positionFromEvent(e: MouseEvent): Position {
		const rect = this._container.getBoundingClientRect();
		const charWidth = this._options.getOption('fontSize') * 0.6;
		const lineHeight = this._options.getOption('lineHeight');
		const x = e.clientX - rect.left + this._layout.getScrollLeft();
		const y = e.clientY - rect.top + this._layout.getScrollTop();
		const lineNumber = Math.max(1, Math.min(this._layout.getLineNumberAtVerticalOffset(y), this._getLineCount()));
		const column = Math.floor(x / charWidth) + 1;
		const lineLength = this._getLineLength(lineNumber);
		return new Position(lineNumber, Math.max(1, Math.min(column, lineLength + 1)));
	}

	private _handleMouseDown(e: MouseEvent): void {
		if (e.button !== 0) {
			return;
		}
		const position = this.positionFromEvent(e);
		const data: IMouseEventData = {
			position,
			event: e,
			clickCount: e.detail > 0 ? e.detail : 1,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
		};
		this._dragStart = position;
		this._isDragging = true;
		this._dragDistance = 0;
		this._onMouseDown.fire(data);
	}

	private _handleMouseMove(e: MouseEvent): void {
		const position = this.positionFromEvent(e);
		if (this._isDragging && this._dragStart) {
			this._dragDistance++;
			if (this._dragDistance > 2) {
				this._onMouseDrag.fire({ start: this._dragStart, current: position });
				this._handleAutoScroll(e);
			}
		} else {
			this._onMouseMove.fire({
				position,
				event: e,
				clickCount: 0,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
			});
		}
	}

	private _handleMouseUp(e: MouseEvent): void {
		if (this._isDragging && this._dragStart) {
			const end = this.positionFromEvent(e);
			this._isDragging = false;
			this._dragStart = null;
			this._stopAutoScroll();
			if (this._dragDistance > 2) {
				this._onMouseDragEnd.fire({ start: this._dragStart ?? end, current: end });
				return;
			}
		}
		this._onMouseUp.fire({
			position: this.positionFromEvent(e),
			event: e,
			clickCount: e.detail > 0 ? e.detail : 1,
			shiftKey: e.shiftKey,
			altKey: e.altKey,
		});
	}

	private _cancelDrag(): void {
		this._isDragging = false;
		this._dragStart = null;
		this._stopAutoScroll();
	}

	private _handleAutoScroll(e: MouseEvent): void {
		if (this._autoScrollFrame) {
			return;
		}
		const rect = this._container.getBoundingClientRect();
		const lineHeight = this._options.getOption('lineHeight');
		const step = () => {
			const scrollTop = this._layout.getScrollTop();
			let target = scrollTop;
			const relativeY = e.clientY - rect.top;
			if (relativeY < 0) {
				target = scrollTop - lineHeight;
			} else if (relativeY > rect.height) {
				target = scrollTop + lineHeight;
			}
			this._layout.setScrollPosition(target, this._layout.getScrollLeft());
		};
		this._autoScrollFrame = window.setInterval(step, 30);
	}

	private _stopAutoScroll(): void {
		if (this._autoScrollFrame) {
			clearInterval(this._autoScrollFrame);
			this._autoScrollFrame = 0;
		}
	}

	override dispose(): void {
		this._stopAutoScroll();
		super.dispose();
	}
}
