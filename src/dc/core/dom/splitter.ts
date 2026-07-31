/**
 * Dardcor Code - Resizable Pane Splitter (Task 81)
 * Mirrors: vs/base/browser/ui/sash/sash.ts
 */

import { IDisposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';

export const enum Orientation {
	VERTICAL = 0,
	HORIZONTAL = 1,
}

export const enum SashState {
	Disabled = 0,
	AtMinimum = 1,
	AtMaximum = 2,
	Enabled = 3,
}

export interface ISashEvent {
	readonly startX: number;
	readonly startY: number;
	readonly currentX: number;
	readonly currentY: number;
	readonly altKey: boolean;
}

export class Sash implements IDisposable {
	private readonly _el: HTMLElement;
	private _orientation: Orientation;
	private _state: SashState = SashState.Enabled;
	private readonly _onDidStart = new Emitter<ISashEvent>();
	private readonly _onDidChange = new Emitter<ISashEvent>();
	private readonly _onDidEnd = new Emitter<void>();
	private readonly _onDidReset = new Emitter<void>();

	readonly onDidStart: Event<ISashEvent> = this._onDidStart.event;
	readonly onDidChange: Event<ISashEvent> = this._onDidChange.event;
	readonly onDidEnd: Event<void> = this._onDidEnd.event;
	readonly onDidReset: Event<void> = this._onDidReset.event;

	constructor(container: HTMLElement, orientation: Orientation) {
		this._orientation = orientation;
		this._el = document.createElement('div');
		this._el.className = orientation === Orientation.VERTICAL
			? 'dc-sash dc-sash-vertical'
			: 'dc-sash dc-sash-horizontal';

		this._el.style.position = 'absolute';
		if (orientation === Orientation.VERTICAL) {
			this._el.style.width = '4px';
			this._el.style.cursor = 'ew-resize';
			this._el.style.top = '0';
			this._el.style.bottom = '0';
		} else {
			this._el.style.height = '4px';
			this._el.style.cursor = 'ns-resize';
			this._el.style.left = '0';
			this._el.style.right = '0';
		}

		this._el.addEventListener('mousedown', (e) => this._onMouseDown(e));
		this._el.addEventListener('dblclick', () => this._onDidReset.fire());
		container.appendChild(this._el);
	}

	get state(): SashState { return this._state; }
	set state(value: SashState) {
		this._state = value;
		this._el.classList.toggle('dc-sash-disabled', value === SashState.Disabled);
	}

	get orientation(): Orientation { return this._orientation; }

	layout(position: number): void {
		if (this._orientation === Orientation.VERTICAL) {
			this._el.style.left = `${position - 2}px`;
		} else {
			this._el.style.top = `${position - 2}px`;
		}
	}

	private _onMouseDown(e: MouseEvent): void {
		if (this._state === SashState.Disabled) return;
		e.preventDefault();
		const startX = e.pageX;
		const startY = e.pageY;

		this._onDidStart.fire({ startX, startY, currentX: startX, currentY: startY, altKey: e.altKey });

		const onMouseMove = (e: MouseEvent) => {
			this._onDidChange.fire({ startX, startY, currentX: e.pageX, currentY: e.pageY, altKey: e.altKey });
		};
		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this._onDidEnd.fire();
		};
		document.addEventListener('mousemove', onMouseMove);
		document.addEventListener('mouseup', onMouseUp);
	}

	dispose(): void {
		this._el.remove();
		this._onDidStart.dispose();
		this._onDidChange.dispose();
		this._onDidEnd.dispose();
		this._onDidReset.dispose();
	}
}
