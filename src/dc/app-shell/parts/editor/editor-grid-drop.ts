/**
 * Dardcor Code - Split Overlay Visual Guide Indicator During Tab Drag
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { $ } from '../../../core/dom/element.js';
import { DropDirection } from './editor-drop-target.js';

export interface IEditorGridDropOptions {
	readonly edgeRatio?: number;
	readonly highlightColor?: string;
}

export class EditorGridDrop extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _zones = new Map<DropDirection, HTMLElement>();
	private _currentDirection: DropDirection | null = null;
	private _enabled = true;
	private readonly _edgeRatio: number;

	constructor(
		container: HTMLElement,
		options: IEditorGridDropOptions = {}
	) {
		super();
		this._edgeRatio = options.edgeRatio ?? 0.3;
		this._container = container;
		const color = options.highlightColor ?? 'rgba(14, 99, 156, 0.85)';

		const zoneStyles: Record<DropDirection, string> = {
			[DropDirection.Center]: `inset:15%;border:2px dashed ${color};background:rgba(14,99,156,0.15);`,
			[DropDirection.Top]: `top:0;left:0;right:0;height:33%;border-bottom:2px solid ${color};background:rgba(14,99,156,0.12);`,
			[DropDirection.Bottom]: `bottom:0;left:0;right:0;height:33%;border-top:2px solid ${color};background:rgba(14,99,156,0.12);`,
			[DropDirection.Left]: `left:0;top:0;bottom:0;width:33%;border-right:2px solid ${color};background:rgba(14,99,156,0.12);`,
			[DropDirection.Right]: `right:0;top:0;bottom:0;width:33%;border-left:2px solid ${color};background:rgba(14,99,156,0.12);`,
		};

		for (const direction of [DropDirection.Center, DropDirection.Top, DropDirection.Bottom, DropDirection.Left, DropDirection.Right]) {
			const zone = $<HTMLElement>('div', 'dc-editor-grid-drop-zone');
			zone.style.cssText = `position:absolute;pointer-events:none;display:none;z-index:60;${zoneStyles[direction]}`;
			this._zones.set(direction, zone);
			container.appendChild(zone);
		}
	}

	get enabled(): boolean {
		return this._enabled;
	}

	setEnabled(enabled: boolean): void {
		this._enabled = enabled;
		if (!enabled) {
			this.hide();
		}
	}

	get currentDirection(): DropDirection | null {
		return this._currentDirection;
	}

	isVisible(): boolean {
		return this._currentDirection !== null;
	}

	update(x: number, y: number): DropDirection {
		if (!this._enabled) {
			return DropDirection.Center;
		}
		const rect = this._container.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) {
			return DropDirection.Center;
		}
		const relX = x - rect.left;
		const relY = y - rect.top;
		const edgeX = rect.width * this._edgeRatio;
		const edgeY = rect.height * this._edgeRatio;

		let direction: DropDirection;
		if (relY < edgeY) {
			direction = DropDirection.Top;
		} else if (relY > rect.height - edgeY) {
			direction = DropDirection.Bottom;
		} else if (relX < edgeX) {
			direction = DropDirection.Left;
		} else if (relX > rect.width - edgeX) {
			direction = DropDirection.Right;
		} else {
			direction = DropDirection.Center;
		}
		this._show(direction);
		return direction;
	}

	showCenter(): void {
		this._show(DropDirection.Center);
	}

	show(): void {
		this._show(this._currentDirection ?? DropDirection.Center);
	}

	hide(): void {
		if (this._currentDirection === null) {
			return;
		}
		this._zones.get(this._currentDirection)!.style.display = 'none';
		this._currentDirection = null;
	}

	private _show(direction: DropDirection): void {
		if (this._currentDirection === direction) {
			return;
		}
		if (this._currentDirection !== null) {
			this._zones.get(this._currentDirection)!.style.display = 'none';
		}
		this._currentDirection = direction;
		this._zones.get(direction)!.style.display = 'block';
	}

	dispose(): void {
		for (const zone of this._zones.values()) {
			zone.remove();
		}
		super.dispose();
	}
}
