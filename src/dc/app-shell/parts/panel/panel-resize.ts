/**
 * Dardcor Code - Panel Height Dragging Bounds Controller
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';

export interface IPanelResizeOptions {
	readonly minHeight?: number;
	readonly maxHeightRatio?: number;
	readonly initialHeight?: number;
}

export class PanelResize extends Disposable {
	private readonly _handle: HTMLElement;
	private _height: number;
	private readonly _minHeight: number;
	private readonly _maxHeightRatio: number;
	private _dragging = false;

	private readonly _onDidChangeHeight = this._register(new Emitter<number>());
	readonly onDidChangeHeight: Event<number> = this._onDidChangeHeight.event;

	private readonly _onDidStart = this._register(new Emitter<void>());
	readonly onDidStart: Event<void> = this._onDidStart.event;

	private readonly _onDidEnd = this._register(new Emitter<void>());
	readonly onDidEnd: Event<void> = this._onDidEnd.event;

	constructor(
		private readonly _panelElement: HTMLElement,
		options: IPanelResizeOptions = {}
	) {
		super();
		this._minHeight = options.minHeight ?? 100;
		this._maxHeightRatio = options.maxHeightRatio ?? 0.8;
		this._height = options.initialHeight ?? (this._panelElement.getBoundingClientRect().height || 200);

		this._handle = $<HTMLElement>('div', 'dc-panel-resize-handle');
		this._handle.style.cssText = 'position:absolute;top:-2px;left:0;right:0;height:5px;cursor:ns-resize;z-index:30;';
		this._panelElement.style.position = 'relative';
		this._panelElement.appendChild(this._handle);

		this._handle.addEventListener('mousedown', (e: MouseEvent) => this._onMouseDown(e));
		this._handle.addEventListener('dblclick', () => {
			this.setHeight(this._minHeight);
		});
	}

	get height(): number {
		return this._height;
	}

	get isDragging(): boolean {
		return this._dragging;
	}

	get maxHeight(): number {
		return window.innerHeight * this._maxHeightRatio;
	}

	setHeight(height: number): void {
		const clamped = Math.max(this._minHeight, Math.min(this.maxHeight, height));
		if (clamped === this._height) {
			return;
		}
		this._height = clamped;
		this._panelElement.style.height = `${clamped}px`;
		this._onDidChangeHeight.fire(clamped);
	}

	private _onMouseDown(e: MouseEvent): void {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		this._dragging = true;
		this._handle.classList.add('dc-panel-resize-dragging');
		this._onDidStart.fire();

		const startY = e.clientY;
		const startHeight = this._height;

		const onMouseMove = (ev: MouseEvent) => {
			const delta = ev.clientY - startY;
			this.setHeight(startHeight - delta);
		};
		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this._dragging = false;
			this._handle.classList.remove('dc-panel-resize-dragging');
			this._onDidEnd.fire();
		};
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	dispose(): void {
		this._handle.remove();
		super.dispose();
	}
}
