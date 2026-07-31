/**
 * Dardcor Code - Sidebar Width Dragging Bounds Controller
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';

export interface ISidebarResizeOptions {
	readonly minWidth?: number;
	readonly maxWidth?: number;
	readonly initialWidth?: number;
	readonly handleSize?: number;
}

export class SidebarResize extends Disposable {
	private readonly _handle: HTMLElement;
	private _width: number;
	private readonly _minWidth: number;
	private readonly _maxWidth: number;
	private _dragging = false;

	private readonly _onDidChangeWidth = this._register(new Emitter<number>());
	readonly onDidChangeWidth: Event<number> = this._onDidChangeWidth.event;

	private readonly _onDidStart = this._register(new Emitter<void>());
	readonly onDidStart: Event<void> = this._onDidStart.event;

	private readonly _onDidEnd = this._register(new Emitter<void>());
	readonly onDidEnd: Event<void> = this._onDidEnd.event;

	constructor(
		private readonly _sidebarElement: HTMLElement,
		options: ISidebarResizeOptions = {}
	) {
		super();
		this._minWidth = options.minWidth ?? 170;
		this._maxWidth = options.maxWidth ?? 500;
		this._width = options.initialWidth ?? (this._sidebarElement.getBoundingClientRect().width || 260);

		this._handle = $<HTMLElement>('div', 'dc-sidebar-resize-handle');
		this._handle.style.cssText = 'position:absolute;top:0;right:-2px;bottom:0;width:5px;cursor:ew-resize;z-index:30;';
		this._sidebarElement.style.position = 'relative';
		this._sidebarElement.appendChild(this._handle);

		this._handle.addEventListener('mousedown', (e: MouseEvent) => this._onMouseDown(e));
		this._handle.addEventListener('dblclick', () => {
			this.setWidth(this._minWidth);
		});
	}

	get width(): number {
		return this._width;
	}

	get isDragging(): boolean {
		return this._dragging;
	}

	get minWidth(): number {
		return this._minWidth;
	}

	get maxWidth(): number {
		return this._maxWidth;
	}

	setWidth(width: number): void {
		const clamped = Math.max(this._minWidth, Math.min(this._maxWidth, width));
		if (clamped === this._width) {
			return;
		}
		this._width = clamped;
		this._sidebarElement.style.width = `${clamped}px`;
		this._onDidChangeWidth.fire(clamped);
	}

	private _onMouseDown(e: MouseEvent): void {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		this._dragging = true;
		this._handle.classList.add('dc-sidebar-resize-dragging');
		this._onDidStart.fire();

		const startX = e.clientX;
		const startWidth = this._width;

		const onMouseMove = (ev: MouseEvent) => {
			const delta = ev.clientX - startX;
			const newWidth = startWidth + delta;
			this.setWidth(newWidth);
		};
		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this._dragging = false;
			this._handle.classList.remove('dc-sidebar-resize-dragging');
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
