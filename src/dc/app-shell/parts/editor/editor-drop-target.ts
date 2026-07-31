/**
 * Dardcor Code - Drag-And-Drop File Tab Splitting Handler
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { addDisposableListener } from '../../../core/dom/element.js';

export const enum DropDirection {
	Center = 0,
	Top = 1,
	Bottom = 2,
	Left = 3,
	Right = 4,
}

export interface IDropEvent {
	readonly direction: DropDirection;
	readonly data: string;
}

export const DROP_DATA_FORMAT = 'application/dc-editor-tab';

export class EditorDropTarget extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _zones = new Map<DropDirection, HTMLElement>();
	private _currentZone: DropDirection | null = null;

	private readonly _onDidDrop = this._register(new Emitter<IDropEvent>());
	readonly onDidDrop: Event<IDropEvent> = this._onDidDrop.event;

	constructor(container: HTMLElement) {
		super();
		this._container = container;

		const zoneStyle: Record<DropDirection, string> = {
			[DropDirection.Center]: 'inset:15%;border:2px dashed rgba(14,99,156,0.9);background:rgba(14,99,156,0.15);z-index:50;',
			[DropDirection.Top]: 'top:0;left:0;right:0;height:33%;border-bottom:2px solid rgba(14,99,156,0.9);background:rgba(14,99,156,0.12);z-index:50;',
			[DropDirection.Bottom]: 'bottom:0;left:0;right:0;height:33%;border-top:2px solid rgba(14,99,156,0.9);background:rgba(14,99,156,0.12);z-index:50;',
			[DropDirection.Left]: 'left:0;top:0;bottom:0;width:33%;border-right:2px solid rgba(14,99,156,0.9);background:rgba(14,99,156,0.12);z-index:50;',
			[DropDirection.Right]: 'right:0;top:0;bottom:0;width:33%;border-left:2px solid rgba(14,99,156,0.9);background:rgba(14,99,156,0.12);z-index:50;',
		};
		for (const direction of [DropDirection.Center, DropDirection.Top, DropDirection.Bottom, DropDirection.Left, DropDirection.Right]) {
			const zone = $<HTMLElement>('div', 'dc-editor-drop-zone');
			zone.style.cssText = 'position:absolute;pointer-events:none;display:none;' + zoneStyle[direction];
			this._zones.set(direction, zone);
			container.appendChild(zone);
		}

		this._register(addDisposableListener(container, 'dragover', (e: globalThis.Event) => {
			const dragEvent = e as DragEvent;
			if (!this._hasTabData(dragEvent)) {
				return;
			}
			dragEvent.preventDefault();
			dragEvent.stopPropagation();
			const direction = this._computeDirection(dragEvent);
			this._showZone(direction);
		}));
		this._register(addDisposableListener(container, 'dragleave', (e: globalThis.Event) => {
			const dragEvent = e as DragEvent;
			if (this._container.contains(dragEvent.relatedTarget as Node)) {
				return;
			}
			this._hideZone();
		}));
		this._register(addDisposableListener(container, 'drop', (e: globalThis.Event) => {
			const dragEvent = e as DragEvent;
			const data = this._readTabData(dragEvent);
			if (data === null) {
				return;
			}
			dragEvent.preventDefault();
			dragEvent.stopPropagation();
			const direction = this._computeDirection(dragEvent);
			this._hideZone();
			this._onDidDrop.fire({ direction, data });
		}));
	}

	private _hasTabData(e: DragEvent): boolean {
		return e.dataTransfer !== null && (e.dataTransfer.types.includes(DROP_DATA_FORMAT) || e.dataTransfer.types.includes('text/plain'));
	}

	private _readTabData(e: DragEvent): string | null {
		if (!e.dataTransfer) {
			return null;
		}
		const custom = e.dataTransfer.getData(DROP_DATA_FORMAT);
		return custom || e.dataTransfer.getData('text/plain');
	}

	private _computeDirection(e: DragEvent): DropDirection {
		const rect = this._container.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const w = rect.width;
		const h = rect.height;
		const edgeX = w * 0.3;
		const edgeY = h * 0.3;
		if (y < edgeY) {
			return DropDirection.Top;
		}
		if (y > h - edgeY) {
			return DropDirection.Bottom;
		}
		if (x < edgeX) {
			return DropDirection.Left;
		}
		if (x > w - edgeX) {
			return DropDirection.Right;
		}
		return DropDirection.Center;
	}

	private _showZone(direction: DropDirection): void {
		if (this._currentZone !== null) {
			this._zones.get(this._currentZone)!.style.display = 'none';
		}
		this._currentZone = direction;
		this._zones.get(direction)!.style.display = 'block';
	}

	private _hideZone(): void {
		if (this._currentZone !== null) {
			this._zones.get(this._currentZone)!.style.display = 'none';
			this._currentZone = null;
		}
	}

	dispose(): void {
		for (const zone of this._zones.values()) {
			zone.remove();
		}
		super.dispose();
	}
}
