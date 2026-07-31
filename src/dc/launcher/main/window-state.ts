import { app, BrowserWindow, screen, Rectangle } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';

export interface WindowStateData {
	bounds: Rectangle;
	maximized: boolean;
	fullscreen: boolean;
	displayId?: number;
}

export interface WindowStateOptions {
	stateFile?: string;
	debounceMs?: number;
	defaultWidth?: number;
	defaultHeight?: number;
}

const DEFAULT_BOUNDS: Rectangle = { x: -1, y: -1, width: 1400, height: 900 };

export class WindowState extends Disposable {
	private _state: WindowStateData;
	private _saveTimer: NodeJS.Timeout | null = null;
	private _applied = false;
	private readonly _stateFile: string;
	private readonly _debounceMs: number;
	private readonly _defaultWidth: number;
	private readonly _defaultHeight: number;

	constructor(options: WindowStateOptions = {}) {
		super();
		this._stateFile = options.stateFile ?? path.join(app.getPath('userData'), 'window-state.json');
		this._debounceMs = options.debounceMs ?? 500;
		this._defaultWidth = options.defaultWidth ?? 1400;
		this._defaultHeight = options.defaultHeight ?? 900;
		this._state = this._load();
	}

	public get state(): WindowStateData {
		return { ...this._state, bounds: { ...this._state.bounds } };
	}

	public get bounds(): Rectangle {
		return { ...this._state.bounds };
	}

	public get maximized(): boolean {
		return this._state.maximized;
	}

	public get fullscreen(): boolean {
		return this._state.fullscreen;
	}

	public setMaximized(value: boolean): void {
		if (this._state.maximized === value) {
			return;
		}
		this._state.maximized = value;
		this._scheduleSave();
	}

	public setFullscreen(value: boolean): void {
		if (this._state.fullscreen === value) {
			return;
		}
		this._state.fullscreen = value;
		this._scheduleSave();
	}

	public updateBounds(bounds: Rectangle): void {
		this._state.bounds = { ...bounds };
		this._scheduleSave();
	}

	public applyTo(window: BrowserWindow): void {
		if (this._applied) {
			return;
		}
		this._applied = true;
		let bounds = this._validatedBounds(this._state.bounds);
		const maximized = this._state.maximized;
		const fullscreen = this._state.fullscreen;

		window.setBounds(bounds);
		if (maximized) {
			window.maximize();
		}
		if (fullscreen) {
			window.setFullScreen(true);
		}

		window.on('resize', () => {
			if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
				this.updateBounds(window.getBounds());
			}
			this.setMaximized(window.isMaximized());
			this.setFullscreen(window.isFullScreen());
		});

		window.on('move', () => {
			if (!window.isMaximized() && !window.isMinimized() && !window.isFullScreen()) {
				this.updateBounds(window.getBounds());
			}
		});

		window.on('maximize', () => this.setMaximized(true));
		window.on('unmaximize', () => this.setMaximized(false));
		window.on('enter-full-screen', () => this.setFullscreen(true));
		window.on('leave-full-screen', () => this.setFullscreen(false));
	}

	public persistNow(): void {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		this._write(this._state);
	}

	public reset(): void {
		this._state = {
			bounds: { ...DEFAULT_BOUNDS, width: this._defaultWidth, height: this._defaultHeight },
			maximized: false,
			fullscreen: false
		};
		this.persistNow();
	}

	public override dispose(): void {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
			this._saveTimer = null;
		}
		this.persistNow();
		super.dispose();
	}

	private _scheduleSave(): void {
		if (this._saveTimer) {
			clearTimeout(this._saveTimer);
		}
		this._saveTimer = setTimeout(() => {
			this._saveTimer = null;
			this._write(this._state);
		}, this._debounceMs);
	}

	private _load(): WindowStateData {
		try {
			const raw = fs.readFileSync(this._stateFile, 'utf-8');
			const data = JSON.parse(raw) as WindowStateData;
			if (!data || typeof data.bounds !== 'object' || !data.bounds) {
				return this._defaultState();
			}
			return {
				bounds: { ...DEFAULT_BOUNDS, ...data.bounds },
				maximized: !!data.maximized,
				fullscreen: !!data.fullscreen,
				displayId: data.displayId
			};
		} catch {
			return this._defaultState();
		}
	}

	private _defaultState(): WindowStateData {
		return {
			bounds: { ...DEFAULT_BOUNDS, width: this._defaultWidth, height: this._defaultHeight },
			maximized: false,
			fullscreen: false
		};
	}

	private _write(data: WindowStateData): void {
		try {
			fs.mkdirSync(path.dirname(this._stateFile), { recursive: true });
			fs.writeFileSync(this._stateFile, JSON.stringify({ ...data, bounds: { ...data.bounds } }, null, 2), 'utf-8');
		} catch (err) {
			console.error('[window-state] failed to persist:', err);
		}
	}

	private _validatedBounds(bounds: Rectangle): Rectangle {
		const displays = screen.getAllDisplays();
		if (displays.length === 0) {
			return { x: 0, y: 0, width: this._defaultWidth, height: this._defaultHeight };
		}
		const display = this._state.displayId
			? displays.find((d) => d.id === this._state.displayId) ?? displays[0]
			: displays[0];
		const area = display.workArea;
		const width = Math.min(bounds.width, area.width);
		const height = Math.min(bounds.height, area.height);
		const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - Math.min(width, 200)));
		const y = Math.max(area.y, Math.min(bounds.y, area.y + area.height - Math.min(height, 100)));
		return { x, y, width, height };
	}
}

export function createWindowState(options?: WindowStateOptions): WindowState {
	const state = new WindowState(options);
	return state;
}

export function getWindowStateFilePath(): string {
	return path.join(app.getPath('userData'), 'window-state.json');
}
