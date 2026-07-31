import { screen, BrowserWindow, Display, Rectangle } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface ScreenChangeEvent {
	type: 'display-added' | 'display-removed' | 'display-metrics-changed';
	display: Display | null;
	displays: Display[];
}

export class ScreenMonitor extends Disposable {
	private readonly _onDidChange = new Emitter<ScreenChangeEvent>();
	public readonly onDidChange = this._onDidChange.event;

	constructor() {
		super();
		this._register(this._onDidChange);
		this._register(toDisposable(() => {
			screen.removeListener('display-added', this._handleAdded as any);
			screen.removeListener('display-removed', this._handleRemoved as any);
			screen.removeListener('display-metrics-changed', this._handleMetrics as any);
		}));
		screen.on('display-added', this._handleAdded as any);
		screen.on('display-removed', this._handleRemoved as any);
		screen.on('display-metrics-changed', this._handleMetrics as any);
	}

	public getDisplays(): Display[] {
		return screen.getAllDisplays();
	}

	public getPrimaryDisplay(): Display {
		return screen.getPrimaryDisplay();
	}

	public getDisplayCount(): number {
		return screen.getAllDisplays().length;
	}

	public getDisplayForWindow(window: BrowserWindow): Display {
		if (window.isDestroyed()) {
			return this.getPrimaryDisplay();
		}
		return screen.getDisplayMatching(window.getBounds());
	}

	public getDisplayForPoint(x: number, y: number): Display {
		return screen.getDisplayNearestPoint({ x, y });
	}

	public getDisplayForBounds(bounds: Rectangle): Display {
		return screen.getDisplayMatching(bounds);
	}

	public getCursorScreenPoint(): { x: number; y: number } {
		return screen.getCursorScreenPoint();
	}

	public getWorkAreaFor(window: BrowserWindow): Rectangle {
		return this.getDisplayForWindow(window).workArea;
	}

	public getDisplayBounds(displayId?: number): Rectangle {
		const display = displayId !== undefined
			? screen.getAllDisplays().find((d) => d.id === displayId) ?? this.getPrimaryDisplay()
			: this.getPrimaryDisplay();
		return display.bounds;
	}

	public getWorkArea(displayId?: number): Rectangle {
		const display = displayId !== undefined
			? screen.getAllDisplays().find((d) => d.id === displayId) ?? this.getPrimaryDisplay()
			: this.getPrimaryDisplay();
		return display.workArea;
	}

	public isWindowOnDisplay(window: BrowserWindow, displayId: number): boolean {
		return this.getDisplayForWindow(window).id === displayId;
	}

	public override dispose(): void {
		super.dispose();
	}

	private _handleAdded = (_event: Electron.Event, display: Display): void => {
		this._onDidChange.fire({ type: 'display-added', display, displays: this.getDisplays() });
	};

	private _handleRemoved = (_event: Electron.Event, display: Display): void => {
		this._onDidChange.fire({ type: 'display-removed', display, displays: this.getDisplays() });
	};

	private _handleMetrics = (_event: Electron.Event, display: Display): void => {
		this._onDidChange.fire({ type: 'display-metrics-changed', display, displays: this.getDisplays() });
	};
}

export function createScreenMonitor(): ScreenMonitor {
	return new ScreenMonitor();
}

export function getDisplays(): Display[] {
	return screen.getAllDisplays();
}

export function getPrimaryDisplay(): Display {
	return screen.getPrimaryDisplay();
}

export function getDisplayCount(): number {
	return screen.getAllDisplays().length;
}
