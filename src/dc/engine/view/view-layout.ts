/**
 * Dardcor Code - Editor Line Layout & Height Mapping (Task 208)
 * Mirrors: vs/editor/browser/viewLayout/viewLayout.ts
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export interface IViewLayoutOptions {
	readonly lineCount: number;
	readonly lineHeight: number;
	readonly scrollWidth: number;
	readonly scrollHeight?: number;
}

export class ViewLayout extends Disposable {
	private _lineCount: number;
	private _lineHeight: number;
	private _scrollWidth: number;

	private readonly _onDidScroll = this._register(new Emitter<{ scrollTop: number; scrollLeft: number }>());
	readonly onDidScroll: Event<{ scrollTop: number; scrollLeft: number }> = this._onDidScroll.event;

	private _scrollTop = 0;
	private _scrollLeft = 0;

	constructor(options: IViewLayoutOptions) {
		super();
		this._lineCount = options.lineCount;
		this._lineHeight = options.lineHeight;
		this._scrollWidth = options.scrollWidth;
	}

	getScrollHeight(): number {
		return this._lineCount * this._lineHeight;
	}

	getScrollWidth(): number {
		return this._scrollWidth;
	}

	getScrollTop(): number {
		return this._scrollTop;
	}

	getScrollLeft(): number {
		return this._scrollLeft;
	}

	setScrollPosition(scrollTop: number, scrollLeft: number): void {
		let changed = false;
		const maxScrollTop = Math.max(0, this.getScrollHeight() - this._lineHeight);
		const targetTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
		if (this._scrollTop !== targetTop) {
			this._scrollTop = targetTop;
			changed = true;
		}
		if (this._scrollLeft !== scrollLeft) {
			this._scrollLeft = Math.max(0, scrollLeft);
			changed = true;
		}
		if (changed) {
			this._onDidScroll.fire({ scrollTop: this._scrollTop, scrollLeft: this._scrollLeft });
		}
	}

	getVerticalOffsetForLineNumber(lineNumber: number): number {
		return (Math.max(1, lineNumber) - 1) * this._lineHeight;
	}

	getLineNumberAtVerticalOffset(verticalOffset: number): number {
		return Math.floor(Math.max(0, verticalOffset) / this._lineHeight) + 1;
	}

	updateLineCount(lineCount: number): void {
		this._lineCount = Math.max(1, lineCount);
	}
}
