import { BrowserWindow, screen, Display } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter } from '../../core/events/emitter.js';

export interface FocusChangeEvent {
	windowId: number | null;
	displayId: number;
	window: BrowserWindow | null;
}

export class WindowFocusManager extends Disposable {
	private _focused: BrowserWindow | null = null;
	private readonly _windows = new Set<BrowserWindow>();
	private readonly _onDidChangeFocus = new Emitter<FocusChangeEvent>();
	public readonly onDidChangeFocus = this._onDidChangeFocus.event;

	constructor() {
		super();
		this._register(this._onDidChangeFocus);
		this._register(toDisposable(() => {
			for (const win of this._windows) {
				win.removeListener('focus', this._handleFocus as any);
				win.removeListener('blur', this._handleBlur as any);
				win.removeListener('closed', this._handleClosed as any);
			}
			this._windows.clear();
		}));
	}

	public track(window: BrowserWindow): void {
		if (this._windows.has(window)) {
			return;
		}
		this._windows.add(window);
		window.on('focus', this._handleFocus as any);
		window.on('blur', this._handleBlur as any);
		window.on('closed', this._handleClosed as any);
		if (window.isFocused()) {
			this._setFocused(window);
		}
	}

	public untrack(window: BrowserWindow): void {
		if (!this._windows.has(window)) {
			return;
		}
		window.removeListener('focus', this._handleFocus as any);
		window.removeListener('blur', this._handleBlur as any);
		window.removeListener('closed', this._handleClosed as any);
		this._windows.delete(window);
		if (this._focused === window) {
			this._setFocused(null);
		}
	}

	public focusWindow(id: number): boolean {
		const win = this._windows.find((w) => !w.isDestroyed() && w.id === id);
		if (!win) {
			return false;
		}
		if (win.isMinimized()) {
			win.restore();
		}
		win.show();
		win.focus();
		this._setFocused(win);
		return true;
	}

	public focusWindowByContent(webContentsId: number): boolean {
		const win = BrowserWindow.fromWebContents(webContentsId as any);
		if (!win) {
			return false;
		}
		return this.focusWindow(win.id);
	}

	public getFocused(): BrowserWindow | null {
		return this._focused;
	}

	public getFocusedId(): number | null {
		return this._focused ? this._focused.id : null;
	}

	public getFocusedPerDisplay(): Map<number, BrowserWindow | null> {
		const map = new Map<number, BrowserWindow | null>();
		for (const display of screen.getAllDisplays()) {
			map.set(display.id, this._focusedWindowOnDisplay(display.id));
		}
		return map;
	}

	public getFocusedOnDisplay(displayId: number): BrowserWindow | null {
		return this._focusedWindowOnDisplay(displayId);
	}

	public isWindowFocused(window: BrowserWindow): boolean {
		return this._focused === window || window.isFocused();
	}

	public refresh(): void {
		const focused = BrowserWindow.getFocusedWindow();
		this._setFocused(focused && !focused.isDestroyed() ? focused : null);
	}

	public focusNext(): void {
		const windows = [...this._windows].filter((w) => !w.isDestroyed() && w.isVisible());
		if (windows.length === 0) {
			return;
		}
		const idx = this._focused ? windows.indexOf(this._focused) : -1;
		const next = windows[(idx + 1) % windows.length];
		this.focusWindow(next.id);
	}

	public focusPrevious(): void {
		const windows = [...this._windows].filter((w) => !w.isDestroyed() && w.isVisible());
		if (windows.length === 0) {
			return;
		}
		const idx = this._focused ? windows.indexOf(this._focused) : 0;
		const prev = windows[(idx - 1 + windows.length) % windows.length];
		this.focusWindow(prev.id);
	}

	public getWindows(): BrowserWindow[] {
		return [...this._windows].filter((w) => !w.isDestroyed());
	}

	public override dispose(): void {
		this._setFocused(null);
		super.dispose();
	}

	private readonly _handleFocus = (win: BrowserWindow): void => {
		this._setFocused(win);
	};

	private readonly _handleBlur = (win: BrowserWindow): void => {
		if (this._focused === win) {
			this._setFocused(null);
		}
	};

	private readonly _handleClosed = (win: BrowserWindow): void => {
		this.untrack(win);
	};

	private _setFocused(window: BrowserWindow | null): void {
		if (this._focused === window) {
			return;
		}
		this._focused = window;
		const display = this._displayOf(window);
		this._onDidChangeFocus.fire({
			windowId: window ? window.id : null,
			displayId: display.id,
			window
		});
	}

	private _displayOf(window: BrowserWindow | null): Display {
		if (!window || window.isDestroyed()) {
			return screen.getPrimaryDisplay();
		}
		return screen.getDisplayMatching(window.getBounds());
	}

	private _focusedWindowOnDisplay(displayId: number): BrowserWindow | null {
		for (const win of this._windows) {
			if (win.isDestroyed()) {
				continue;
			}
			const display = screen.getDisplayMatching(win.getBounds());
			if (display.id === displayId && win.isFocused()) {
				return win;
			}
		}
		return null;
	}
}

export function createWindowFocusManager(): WindowFocusManager {
	return new WindowFocusManager();
}
