import { Tray } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable';

export interface TrayEventHandlers {
	onClick?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onDoubleClick?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onRightClick?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onMiddleClick?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onMouseDown?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onMouseUp?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onMouseEnter?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onMouseLeave?: (event: Electron.KeyboardEvent, bounds: Electron.Rectangle) => void;
	onDrop?: () => void;
}

export class SystemTrayEvents extends Disposable {
	private readonly _handlers: TrayEventHandlers;
	private readonly _tray: Tray;
	private _wired = false;

	constructor(tray: Tray, handlers: TrayEventHandlers = {}) {
		super();
		this._tray = tray;
		this._handlers = handlers;
	}

	public wire(): void {
		if (this._wired) {
			return;
		}
		this._wired = true;
		const handlers = this._handlers;

		if (handlers.onClick) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onClick?.(event, bounds);
			this._tray.on('click', listener);
			this._register(toDisposable(() => this._tray.removeListener('click', listener)));
		}
		if (handlers.onDoubleClick) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onDoubleClick?.(event, bounds);
			this._tray.on('double-click', listener);
			this._register(toDisposable(() => this._tray.removeListener('double-click', listener)));
		}
		if (handlers.onRightClick) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onRightClick?.(event, bounds);
			this._tray.on('right-click', listener);
			this._register(toDisposable(() => this._tray.removeListener('right-click', listener)));
		}
		if (handlers.onMiddleClick) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onMiddleClick?.(event, bounds);
			this._tray.on('middle-click', listener);
			this._register(toDisposable(() => this._tray.removeListener('middle-click', listener)));
		}
		if (handlers.onMouseDown) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onMouseDown?.(event, bounds);
			this._tray.on('mouse-down', listener);
			this._register(toDisposable(() => this._tray.removeListener('mouse-down', listener)));
		}
		if (handlers.onMouseUp) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onMouseUp?.(event, bounds);
			this._tray.on('mouse-up', listener);
			this._register(toDisposable(() => this._tray.removeListener('mouse-up', listener)));
		}
		if (handlers.onMouseEnter) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onMouseEnter?.(event, bounds);
			this._tray.on('mouse-enter', listener);
			this._register(toDisposable(() => this._tray.removeListener('mouse-enter', listener)));
		}
		if (handlers.onMouseLeave) {
			const listener = (event: Electron.KeyboardEvent, bounds: Electron.Rectangle): void => handlers.onMouseLeave?.(event, bounds);
			this._tray.on('mouse-leave', listener);
			this._register(toDisposable(() => this._tray.removeListener('mouse-leave', listener)));
		}
		if (handlers.onDrop) {
			const listener = (): void => handlers.onDrop?.();
			this._tray.on('drop-files', listener);
			this._register(toDisposable(() => this._tray.removeListener('drop-files', listener)));
		}
	}

	public isWired(): boolean {
		return this._wired;
	}

	public override dispose(): void {
		this._wired = false;
		super.dispose();
	}
}

export function wireTrayEvents(tray: Tray, handlers: TrayEventHandlers): SystemTrayEvents {
	const events = new SystemTrayEvents(tray, handlers);
	events.wire();
	return events;
}
