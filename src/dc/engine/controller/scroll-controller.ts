/**
 * Dardcor Code - Editor Scroll Physics Controller (Task 224)
 * Mirrors: vs/editor/browser/controller/scrollController.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { addDisposableListener } from '../../core/dom/element';
import { Emitter, Event } from '../../core/events/emitter';
import { ViewLayout } from '../view/view-layout';
import { EditorOptions } from '../options/editor-options';

const WHEEL_SMOOTHING_FACTOR = 0.3;
const WHEEL_EPSILON = 0.5;

export class ScrollController extends Disposable {
	private _targetTop: number | null = null;
	private _animating = false;
	private _syncDomTop: number | null = null;

	private readonly _onDidScroll = this._register(new Emitter<void>());
	readonly onDidScroll: Event<void> = this._onDidScroll.event;

	constructor(
		private readonly _scrollContainer: HTMLElement,
		private readonly _layout: ViewLayout,
		private readonly _options: EditorOptions,
		private readonly _getViewportHeight: () => number
	) {
		super();
		this._register(addDisposableListener(this._scrollContainer, 'scroll', () => this._handleScroll()));
		this._register(addDisposableListener(this._scrollContainer, 'wheel', e => this._handleWheel(e as WheelEvent), { passive: false }));
		this._register(this._layout.onDidScroll(() => this._syncDomFromLayout()));
	}

	getScrollTop(): number {
		return this._layout.getScrollTop();
	}

	getScrollLeft(): number {
		return this._layout.getScrollLeft();
	}

	scrollToTop(): void {
		this._layout.setScrollPosition(0, this._layout.getScrollLeft());
	}

	scrollToBottom(): void {
		const max = Math.max(0, this._layout.getScrollHeight() - this._getViewportHeight());
		this._layout.setScrollPosition(max, this._layout.getScrollLeft());
	}

	scrollToLine(lineNumber: number, center = false): void {
		const top = this._layout.getVerticalOffsetForLineNumber(lineNumber);
		let target = top;
		if (center) {
			target = top - (this._getViewportHeight() - this._options.getOption('lineHeight')) / 2;
		}
		const max = Math.max(0, this._layout.getScrollHeight() - this._getViewportHeight());
		this._layout.setScrollPosition(Math.max(0, Math.min(target, max)), this._layout.getScrollLeft());
	}

	scrollByLines(delta: number): void {
		const lineHeight = this._options.getOption('lineHeight');
		this._layout.setScrollPosition(this._layout.getScrollTop() + delta * lineHeight, this._layout.getScrollLeft());
	}

	scrollByPage(delta: number): void {
		this._layout.setScrollPosition(this._layout.getScrollTop() + delta * this._getViewportHeight(), this._layout.getScrollLeft());
	}

	ensureVisible(top: number, bottom: number): void {
		const viewportTop = this._layout.getScrollTop();
		const viewportBottom = viewportTop + this._getViewportHeight();
		if (top < viewportTop) {
			this._layout.setScrollPosition(top, this._layout.getScrollLeft());
		} else if (bottom > viewportBottom) {
			this._layout.setScrollPosition(bottom - this._getViewportHeight(), this._layout.getScrollLeft());
		}
	}

	private _handleScroll(): void {
		this._layout.setScrollPosition(this._scrollContainer.scrollTop, this._scrollContainer.scrollLeft);
		this._onDidScroll.fire();
	}

	private _handleWheel(e: WheelEvent): void {
		if (e.ctrlKey || e.metaKey) {
			return; // let the browser zoom
		}
		e.preventDefault();
		const lineHeight = this._options.getOption('lineHeight');
		let delta = e.deltaY;
		if (e.deltaMode === 1) {
			delta *= lineHeight;
		}
		delta *= 3;
		const max = Math.max(0, this._layout.getScrollHeight() - this._getViewportHeight());
		this._targetTop = Math.max(0, Math.min(this._layout.getScrollTop() + delta, max));
		this._startAnimation();
	}

	private _startAnimation(): void {
		if (this._animating || this._targetTop === null) {
			return;
		}
		this._animating = true;
		const step = () => {
			if (this._targetTop === null) {
				this._animating = false;
				return;
			}
			const current = this._layout.getScrollTop();
			const diff = this._targetTop - current;
			if (Math.abs(diff) < WHEEL_EPSILON) {
				this._layout.setScrollPosition(this._targetTop, this._layout.getScrollLeft());
				this._targetTop = null;
				this._animating = false;
				return;
			}
			this._layout.setScrollPosition(current + diff * WHEEL_SMOOTHING_FACTOR, this._layout.getScrollLeft());
			window.requestAnimationFrame(step);
		};
		window.requestAnimationFrame(step);
	}

	private _syncDomFromLayout(): void {
		const top = this._layout.getScrollTop();
		const left = this._layout.getScrollLeft();
		if (this._scrollContainer.scrollTop !== top) {
			this._scrollContainer.scrollTop = top;
		}
		if (this._scrollContainer.scrollLeft !== left) {
			this._scrollContainer.scrollLeft = left;
		}
	}
}
