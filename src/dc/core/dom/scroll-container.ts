/**
 * Dardcor Code - Custom Smooth Scrollbar Widget (Task 64)
 * Mirrors: vs/base/browser/ui/scrollbar/
 */

import { IDisposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';

export interface IScrollDimensions {
	width: number;
	height: number;
	scrollWidth: number;
	scrollHeight: number;
}

export interface IScrollPosition {
	scrollLeft: number;
	scrollTop: number;
}

export interface IScrollEvent {
	oldScrollTop: number;
	scrollTop: number;
	oldScrollLeft: number;
	scrollLeft: number;
	scrollTopChanged: boolean;
	scrollLeftChanged: boolean;
	oldWidth: number;
	width: number;
	oldHeight: number;
	height: number;
	oldScrollWidth: number;
	scrollWidth: number;
	oldScrollHeight: number;
	scrollHeight: number;
}

export class Scrollable implements IDisposable {
	private _dimensions: IScrollDimensions;
	private _position: IScrollPosition;
	private readonly _onScroll = new Emitter<IScrollEvent>();
	public readonly onScroll: Event<IScrollEvent> = this._onScroll.event;

	constructor() {
		this._dimensions = { width: 0, height: 0, scrollWidth: 0, scrollHeight: 0 };
		this._position = { scrollLeft: 0, scrollTop: 0 };
	}

	dispose(): void {
		this._onScroll.dispose();
	}

	getDimensions(): IScrollDimensions {
		return { ...this._dimensions };
	}

	setDimensions(dims: Partial<IScrollDimensions>): void {
		const old = { ...this._dimensions };
		Object.assign(this._dimensions, dims);
		this._fireScroll(old, { ...this._position });
	}

	getPosition(): IScrollPosition {
		return { ...this._position };
	}

	setScrollPosition(pos: Partial<IScrollPosition>): void {
		const old = { ...this._position };
		if (pos.scrollLeft !== undefined) {
			this._position.scrollLeft = Math.max(0, Math.min(
				this._dimensions.scrollWidth - this._dimensions.width, pos.scrollLeft
			));
		}
		if (pos.scrollTop !== undefined) {
			this._position.scrollTop = Math.max(0, Math.min(
				this._dimensions.scrollHeight - this._dimensions.height, pos.scrollTop
			));
		}
		this._fireScroll({ width: this._dimensions.width, height: this._dimensions.height, scrollWidth: this._dimensions.scrollWidth, scrollHeight: this._dimensions.scrollHeight }, old);
	}

	private _fireScroll(oldDims: IScrollDimensions, oldPos: IScrollPosition): void {
		this._onScroll.fire({
			oldScrollTop: oldPos.scrollTop,
			scrollTop: this._position.scrollTop,
			oldScrollLeft: oldPos.scrollLeft,
			scrollLeft: this._position.scrollLeft,
			scrollTopChanged: oldPos.scrollTop !== this._position.scrollTop,
			scrollLeftChanged: oldPos.scrollLeft !== this._position.scrollLeft,
			oldWidth: oldDims.width,
			width: this._dimensions.width,
			oldHeight: oldDims.height,
			height: this._dimensions.height,
			oldScrollWidth: oldDims.scrollWidth,
			scrollWidth: this._dimensions.scrollWidth,
			oldScrollHeight: oldDims.scrollHeight,
			scrollHeight: this._dimensions.scrollHeight,
		});
	}
}

export class ScrollbarVisibilityController {
	private _visibility: 'auto' | 'visible' | 'hidden';
	private _visibleClassName: string;
	private _invisibleClassName: string;
	private _domNode: HTMLElement | null = null;
	private _shouldBeVisible: boolean = false;
	private _fadeTimeout: any;

	constructor(visibility: 'auto' | 'visible' | 'hidden', visibleClassName: string, invisibleClassName: string) {
		this._visibility = visibility;
		this._visibleClassName = visibleClassName;
		this._invisibleClassName = invisibleClassName;
	}

	setDomNode(domNode: HTMLElement): void {
		this._domNode = domNode;
		this._applyVisibility();
	}

	setShouldBeVisible(rawShouldBeVisible: boolean): void {
		this._shouldBeVisible = rawShouldBeVisible;
		this._applyVisibility();
	}

	private _applyVisibility(): void {
		if (!this._domNode) return;
		if (this._visibility === 'hidden') {
			this._domNode.classList.add(this._invisibleClassName);
			this._domNode.classList.remove(this._visibleClassName);
		} else if (this._visibility === 'visible') {
			this._domNode.classList.add(this._visibleClassName);
			this._domNode.classList.remove(this._invisibleClassName);
		} else {
			// auto
			clearTimeout(this._fadeTimeout);
			if (this._shouldBeVisible) {
				this._domNode.classList.add(this._visibleClassName);
				this._domNode.classList.remove(this._invisibleClassName);
			} else {
				this._fadeTimeout = setTimeout(() => {
					this._domNode?.classList.add(this._invisibleClassName);
					this._domNode?.classList.remove(this._visibleClassName);
				}, 800);
			}
		}
	}

	dispose(): void {
		clearTimeout(this._fadeTimeout);
	}
}
