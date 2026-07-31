/**
 * Dardcor Code - Touch Swipe & Pinch-to-Zoom Listener (Task 245)
 * Mirrors: vs/editor/browser/controller/touch.ts
 */

import { addDisposableListener } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export const enum TouchGestureType {
	Tap = 0,
	DoubleTap = 1,
	Swipe = 2,
	Pinch = 3,
	LongPress = 4,
}

export interface ITouchGestureEvent {
	readonly type: TouchGestureType;
	readonly x: number;
	readonly y: number;
	readonly startX: number;
	readonly startY: number;
	readonly dx: number;
	readonly dy: number;
	readonly scale: number;
	readonly timestamp: number;
}

export interface ITouchInputOptions {
	readonly swipeThreshold: number;
	readonly doubleTapDelay: number;
	readonly longPressDelay: number;
}

interface ITouchPointer {
	readonly id: number;
	x: number;
	y: number;
}

export class TouchInput extends Disposable {
	private readonly _pointers = new Map<number, ITouchPointer>();
	private _lastTapTime = 0;
	private _lastTapX = 0;
	private _lastTapY = 0;
	private _longPressTimer: ReturnType<typeof setTimeout> | null = null;
	private _gestureStartX = 0;
	private _gestureStartY = 0;
	private _initialDistance = 0;
	private _lastScale = 1;
	private _options: ITouchInputOptions;

	private readonly _onTap = this._register(new Emitter<ITouchGestureEvent>());
	readonly onTap: Event<ITouchGestureEvent> = this._onTap.event;

	private readonly _onDoubleTap = this._register(new Emitter<ITouchGestureEvent>());
	readonly onDoubleTap: Event<ITouchGestureEvent> = this._onDoubleTap.event;

	private readonly _onSwipe = this._register(new Emitter<ITouchGestureEvent>());
	readonly onSwipe: Event<ITouchGestureEvent> = this._onSwipe.event;

	private readonly _onPinch = this._register(new Emitter<ITouchGestureEvent>());
	readonly onPinch: Event<ITouchGestureEvent> = this._onPinch.event;

	constructor(element: HTMLElement, options: Partial<ITouchInputOptions> = {}) {
		super();
		this._options = {
			swipeThreshold: options.swipeThreshold ?? 30,
			doubleTapDelay: options.doubleTapDelay ?? 300,
			longPressDelay: options.longPressDelay ?? 500,
		};
		this._register(addDisposableListener(element, 'touchstart', (e: TouchEvent) => this._onTouchStart(e), { passive: true }));
		this._register(addDisposableListener(element, 'touchmove', (e: TouchEvent) => this._onTouchMove(e), { passive: true }));
		this._register(addDisposableListener(element, 'touchend', (e: TouchEvent) => this._onTouchEnd(e), { passive: true }));
		this._register(addDisposableListener(element, 'touchcancel', (e: TouchEvent) => this._onTouchEnd(e), { passive: true }));
	}

	private _onTouchStart(event: TouchEvent): void {
		for (let i = 0; i < event.changedTouches.length; i++) {
			const touch = event.changedTouches[i];
			this._pointers.set(touch.identifier, { id: touch.identifier, x: touch.clientX, y: touch.clientY });
		}
		if (this._pointers.size === 1) {
			const first = this._pointers.values().next().value as ITouchPointer;
			this._gestureStartX = first.x;
			this._gestureStartY = first.y;
			this._lastScale = 1;
			this._scheduleLongPress(first.x, first.y);
		} else if (this._pointers.size === 2) {
			this._clearLongPress();
			const [a, b] = Array.from(this._pointers.values());
			this._initialDistance = TouchInput._distance(a, b);
			this._lastScale = 1;
		}
		event.preventDefault();
	}

	private _onTouchMove(event: TouchEvent): void {
		for (let i = 0; i < event.changedTouches.length; i++) {
			const touch = event.changedTouches[i];
			const pointer = this._pointers.get(touch.identifier);
			if (pointer) {
				pointer.x = touch.clientX;
				pointer.y = touch.clientY;
			}
		}
		if (this._pointers.size === 2) {
			const [a, b] = Array.from(this._pointers.values());
			const distance = TouchInput._distance(a, b);
			if (this._initialDistance > 0) {
				const scale = distance / this._initialDistance;
				if (Math.abs(scale - this._lastScale) > 0.02) {
					this._lastScale = scale;
					this._onPinch.fire({
						type: TouchGestureType.Pinch,
						x: (a.x + b.x) / 2,
						y: (a.y + b.y) / 2,
						startX: this._gestureStartX,
						startY: this._gestureStartY,
						dx: 0,
						dy: 0,
						scale,
						timestamp: Date.now(),
					});
				}
			}
		}
		this._clearLongPress();
		event.preventDefault();
	}

	private _onTouchEnd(event: TouchEvent): void {
		for (let i = 0; i < event.changedTouches.length; i++) {
			const touch = event.changedTouches[i];
			const pointer = this._pointers.get(touch.identifier);
			if (pointer && this._pointers.size === 1) {
				this._handleSinglePointerEnd(pointer);
			}
			this._pointers.delete(touch.identifier);
		}
		this._clearLongPress();
		event.preventDefault();
	}

	private _handleSinglePointerEnd(pointer: ITouchPointer): void {
		const dx = pointer.x - this._gestureStartX;
		const dy = pointer.y - this._gestureStartY;
		const distance = Math.hypot(dx, dy);
		const now = Date.now();

		if (distance > this._options.swipeThreshold) {
			this._onSwipe.fire({
				type: TouchGestureType.Swipe,
				x: pointer.x,
				y: pointer.y,
				startX: this._gestureStartX,
				startY: this._gestureStartY,
				dx,
				dy,
				scale: 1,
				timestamp: now,
			});
			this._lastTapTime = 0;
			return;
		}

		const isDoubleTap = now - this._lastTapTime < this._options.doubleTapDelay
			&& Math.abs(pointer.x - this._lastTapX) < 20
			&& Math.abs(pointer.y - this._lastTapY) < 20;

		if (isDoubleTap) {
			this._lastTapTime = 0;
			this._onDoubleTap.fire({
				type: TouchGestureType.DoubleTap,
				x: pointer.x,
				y: pointer.y,
				startX: this._gestureStartX,
				startY: this._gestureStartY,
				dx: 0,
				dy: 0,
				scale: 1,
				timestamp: now,
			});
		} else {
			this._lastTapTime = now;
			this._lastTapX = pointer.x;
			this._lastTapY = pointer.y;
			this._onTap.fire({
				type: TouchGestureType.Tap,
				x: pointer.x,
				y: pointer.y,
				startX: this._gestureStartX,
				startY: this._gestureStartY,
				dx: 0,
				dy: 0,
				scale: 1,
				timestamp: now,
			});
		}
	}

	private _scheduleLongPress(x: number, y: number): void {
		this._clearLongPress();
		this._longPressTimer = setTimeout(() => {
			this._onTap.fire({
				type: TouchGestureType.LongPress,
				x,
				y,
				startX: x,
				startY: y,
				dx: 0,
				dy: 0,
				scale: 1,
				timestamp: Date.now(),
			});
		}, this._options.longPressDelay);
	}

	private _clearLongPress(): void {
		if (this._longPressTimer !== null) {
			clearTimeout(this._longPressTimer);
			this._longPressTimer = null;
		}
	}

	private static _distance(a: ITouchPointer, b: ITouchPointer): number {
		return Math.hypot(a.x - b.x, a.y - b.y);
	}

	public override dispose(): void {
		this._clearLongPress();
		this._pointers.clear();
		super.dispose();
	}
}
