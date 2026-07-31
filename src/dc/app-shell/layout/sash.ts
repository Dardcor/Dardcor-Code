/**
 * Dardcor Code - Resizable DOM Sash Splitter Handle Component
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';

export const enum SashOrientation {
	VERTICAL = 0,
	HORIZONTAL = 1,
}

export interface ISashDragEvent {
	readonly startX: number;
	readonly startY: number;
	readonly currentX: number;
	readonly currentY: number;
	readonly deltaX: number;
	readonly deltaY: number;
}

export class Sash extends Disposable {
	private readonly _el: HTMLElement;
	private _enabled = true;

	private readonly _onDidStart = this._register(new Emitter<ISashDragEvent>());
	private readonly _onDidChange = this._register(new Emitter<ISashDragEvent>());
	private readonly _onDidEnd = this._register(new Emitter<void>());
	private readonly _onDidReset = this._register(new Emitter<void>());

	readonly onDidStart: Event<ISashDragEvent> = this._onDidStart.event;
	readonly onDidChange: Event<ISashDragEvent> = this._onDidChange.event;
	readonly onDidEnd: Event<void> = this._onDidEnd.event;
	readonly onDidReset: Event<void> = this._onDidReset.event;

	constructor(
		container: HTMLElement,
		private readonly _orientation: SashOrientation
	) {
		super();
		this._el = $<HTMLElement>('div', _orientation === SashOrientation.VERTICAL ? 'dc-sash dc-sash-vertical' : 'dc-sash dc-sash-horizontal');
		this._el.style.cssText = 'position:absolute;z-index:35;background:transparent;' +
			(_orientation === SashOrientation.VERTICAL
				? 'width:4px;cursor:ew-resize;top:0;bottom:0;'
				: 'height:4px;cursor:ns-resize;left:0;right:0;');
		container.appendChild(this._el);

		this._el.addEventListener('mousedown', (e: MouseEvent) => this._onMouseDown(e));
		this._el.addEventListener('dblclick', () => {
			if (this._enabled) {
				this._onDidReset.fire();
			}
		});
	}

	get enabled(): boolean {
		return this._enabled;
	}

	set enabled(value: boolean) {
		this._enabled = value;
		this._el.classList.toggle('dc-sash-disabled', !value);
		this._el.style.pointerEvents = value ? 'auto' : 'none';
	}

	get orientation(): SashOrientation {
		return this._orientation;
	}

	get element(): HTMLElement {
		return this._el;
	}

	layout(position: number): void {
		if (this._orientation === SashOrientation.VERTICAL) {
			this._el.style.left = `${position - 2}px`;
		} else {
			this._el.style.top = `${position - 2}px`;
		}
	}

	private _onMouseDown(e: MouseEvent): void {
		if (!this._enabled) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		const startX = e.clientX;
		const startY = e.clientY;
		this._onDidStart.fire({ startX, startY, currentX: startX, currentY: startY, deltaX: 0, deltaY: 0 });

		const onMouseMove = (ev: MouseEvent) => {
			this._onDidChange.fire({
				startX,
				startY,
				currentX: ev.clientX,
				currentY: ev.clientY,
				deltaX: ev.clientX - startX,
				deltaY: ev.clientY - startY,
			});
		};
		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this._el.classList.remove('dc-sash-dragging');
			this._onDidEnd.fire();
		};
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
		this._el.classList.add('dc-sash-dragging');
	}
}
