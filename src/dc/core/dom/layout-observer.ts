/**
 * Dardcor Code - Element Resize & Layout Observer
 */

import { IDisposable } from '../lifecycle/disposable.js';
import { Emitter, Event } from '../events/emitter.js';

export interface DOMNodePagePosition {
	left: number;
	top: number;
	width: number;
	height: number;
}

export class LayoutObserver implements IDisposable {
	private _observer: ResizeObserver | null = null;
	private readonly _onDidResize = new Emitter<DOMNodePagePosition>();

	readonly onDidResize: Event<DOMNodePagePosition> = this._onDidResize.event;

	constructor(element: HTMLElement) {
		if (typeof ResizeObserver !== 'undefined') {
			this._observer = new ResizeObserver(entries => {
				for (const entry of entries) {
					this._onDidResize.fire({
						left: entry.contentRect.left,
						top: entry.contentRect.top,
						width: entry.contentRect.width,
						height: entry.contentRect.height
					});
				}
			});
			this._observer.observe(element);
		}
	}

	dispose(): void {
		this._observer?.disconnect();
		this._observer = null;
		this._onDidResize.dispose();
	}
}
