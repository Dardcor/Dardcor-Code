/**
 * Dardcor Code - Mouse Wheel Horizontal Scroll Handler For Editor Tab Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';

export interface IEditorTabScrollOptions {
	readonly scrollOnVerticalWheel?: boolean;
	readonly scrollOnHorizontalWheel?: boolean;
	readonly scrollOnShiftWheel?: boolean;
	readonly maxDeltaPerWheel?: number;
	readonly scrollBehavior?: 'auto' | 'smooth';
}

export interface IEditorTabScrollEvent {
	readonly scrollLeft: number;
	readonly maxScrollLeft: number;
	readonly delta: number;
}

export class EditorTabScroll extends Disposable {
	private readonly _tabBar: HTMLElement;
	private readonly _options: IEditorTabScrollOptions;
	private _isDragging = false;

	private readonly _onDidScroll = this._register(new Emitter<IEditorTabScrollEvent>());
	readonly onDidScroll: Event<IEditorTabScrollEvent> = this._onDidScroll.event;

	constructor(
		tabBar: HTMLElement,
		options: IEditorTabScrollOptions = {}
	) {
		super();
		this._tabBar = tabBar;
		this._options = options;

		const onWheel = (e: WheelEvent) => this._onWheel(e);
		this._tabBar.addEventListener('wheel', onWheel, { passive: false });
		this._register({
			dispose: () => this._tabBar.removeEventListener('wheel', onWheel)
		});

		this._tabBar.addEventListener('dragstart', () => {
			this._isDragging = true;
		});
		this._tabBar.addEventListener('dragend', () => {
			this._isDragging = false;
		});
	}

	get scrollLeft(): number {
		return this._tabBar.scrollLeft;
	}

	get maxScrollLeft(): number {
		return Math.max(0, this._tabBar.scrollWidth - this._tabBar.clientWidth);
	}

	scrollBy(delta: number): void {
		this._tabBar.scrollLeft = Math.max(0, Math.min(this.maxScrollLeft, this._tabBar.scrollLeft + delta));
		this._fire();
	}

	scrollTo(scrollLeft: number): void {
		this._tabBar.scrollLeft = Math.max(0, Math.min(this.maxScrollLeft, scrollLeft));
		this._fire();
	}

	scrollToTab(tab: HTMLElement): void {
		const target = tab.offsetLeft - (this._tabBar.clientWidth - tab.offsetWidth) / 2;
		this.scrollTo(target);
	}

	scrollToEnd(): void {
		this.scrollTo(this.maxScrollLeft);
	}

	scrollToStart(): void {
		this.scrollTo(0);
	}

	scrollIntoView(tab: HTMLElement): void {
		const left = tab.offsetLeft;
		const right = left + tab.offsetWidth;
		const viewLeft = this._tabBar.scrollLeft;
		const viewRight = viewLeft + this._tabBar.clientWidth;
		if (left < viewLeft) {
			this.scrollTo(left);
		} else if (right > viewRight) {
			this.scrollTo(right - this._tabBar.clientWidth);
		}
	}

	handleDragEdgeScroll(mouseX: number): void {
		if (!this._isDragging) {
			return;
		}
		const rect = this._tabBar.getBoundingClientRect();
		const edgeZone = 32;
		if (mouseX < rect.left + edgeZone) {
			this.scrollBy(-12);
		} else if (mouseX > rect.right - edgeZone) {
			this.scrollBy(12);
		}
	}

	private _onWheel(e: WheelEvent): void {
		const options = this._options;
		const useVertical = (options.scrollOnVerticalWheel ?? true) && Math.abs(e.deltaY) > Math.abs(e.deltaX);
		const useHorizontal = (options.scrollOnHorizontalWheel ?? true) && Math.abs(e.deltaX) > Math.abs(e.deltaY);
		const useShift = (options.scrollOnShiftWheel ?? true) && e.shiftKey;

		if (!useVertical && !useHorizontal && !useShift) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		const rawDelta = useShift ? e.deltaY : useVertical ? e.deltaY : e.deltaX;
		const maxDelta = options.maxDeltaPerWheel ?? 120;
		const delta = Math.max(-maxDelta, Math.min(maxDelta, rawDelta));

		if (options.scrollBehavior === 'smooth') {
			this._tabBar.scrollTo({ left: this._tabBar.scrollLeft + delta, behavior: 'smooth' });
		} else {
			this.scrollBy(delta);
		}
	}

	private _fire(): void {
		this._onDidScroll.fire({ scrollLeft: this.scrollLeft, maxScrollLeft: this.maxScrollLeft, delta: 0 });
	}

	dispose(): void {
		super.dispose();
	}
}
