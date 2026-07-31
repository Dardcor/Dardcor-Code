import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import { Disposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { getTrayIcon, getTrayIconPath } from './system-tray-icon.js';
import { buildTrayMenu, defaultTrayMenu } from './system-tray-menu.js';
import { SystemTrayEvents, TrayEventHandlers } from './system-tray-events.js';
import { setTrayTooltip, getStatusTooltip } from './system-tray-tooltip.js';

export interface SystemTrayOptions {
	iconPath?: string;
	tooltip?: string;
	title?: string;
	onShowWindow?: () => void;
	onQuit?: () => void;
	menuItems?: { label: string; click: () => void; type?: 'normal' | 'separator' | 'checkbox' | 'radio'; checked?: boolean; enabled?: boolean }[];
}

export class SystemTray extends Disposable {
	private _tray: Tray | null = null;
	private _tooltip: string;
	private readonly _options: SystemTrayOptions;
	private _events: SystemTrayEvents | null = null;

	constructor(options: SystemTrayOptions = {}) {
		super();
		this._options = options;
		this._tooltip = options.tooltip ?? 'Dardcor Code';
	}

	public create(): boolean {
		if (this._tray) {
			return true;
		}
		try {
			this._tray = new Tray(getTrayIcon());
			this._applyIcon();
			this._tray.setToolTip(this._tooltip);
			this._wireEvents();
			this._buildContextMenu();
			this._register(toDisposable(() => this.destroy()));
			return true;
		} catch (err) {
			console.error('[system-tray] failed to create tray:', err);
			return false;
		}
	}

	public get tray(): Tray | null {
		return this._tray;
	}

	public isCreated(): boolean {
		return this._tray !== null;
	}

	public setTooltip(tooltip: string): void {
		this._tooltip = tooltip;
		if (this._tray) {
			setTrayTooltip(this._tray, tooltip);
		}
	}

	public setStatusTooltip(status: string): void {
		this.setTooltip(getStatusTooltip(status));
	}

	public setIcon(iconPath: string): void {
		if (!this._tray) {
			return;
		}
		const image = nativeImage.createFromPath(iconPath);
		if (!image.isEmpty()) {
			this._tray.setImage(image);
		}
	}

	public setContextMenu(menu: Menu): void {
		if (this._tray) {
			this._tray.setContextMenu(menu);
		}
	}

	public showBalloon(title: string, content: string): void {
		if (!this._tray) {
			return;
		}
		try {
			this._tray.displayBalloon({ title, content });
		} catch {
			// Fallback handled by caller.
		}
	}

	public showWindow(): void {
		this._options.onShowWindow?.();
	}

	public focusMainWindow(): void {
		const windows = BrowserWindow.getAllWindows();
		if (windows.length === 0) {
			this._options.onShowWindow?.();
			return;
		}
		const win = windows.find((w) => !w.isDestroyed() && w.isVisible()) ?? windows[0];
		if (win.isMinimized()) {
			win.restore();
		}
		win.show();
		win.focus();
	}

	public destroy(): void {
		this._events?.dispose();
		this._events = null;
		if (this._tray) {
			try {
				this._tray.destroy();
			} catch {
				// Already destroyed.
			}
			this._tray = null;
		}
	}

	public override dispose(): void {
		this.destroy();
		super.dispose();
	}

	private _applyIcon(): void {
		if (!this._tray) {
			return;
		}
		const iconPath = this._options.iconPath ?? getTrayIconPath();
		const image = nativeImage.createFromPath(iconPath);
		if (!image.isEmpty()) {
			this._tray.setImage(image);
		}
	}

	private _wireEvents(): void {
		if (!this._tray) {
			return;
		}
		const handlers: TrayEventHandlers = {
			onClick: () => this.focusMainWindow(),
			onDoubleClick: () => this.focusMainWindow(),
			onRightClick: () => {
				if (this._tray) {
					this._tray.popUpContextMenu();
				}
			}
		};
		this._events = new SystemTrayEvents(this._tray, handlers);
		this._events.wire();
		this._register(this._events);
	}

	private _buildContextMenu(): void {
		if (!this._tray) {
			return;
		}
		if (this._options.menuItems) {
			this._tray.setContextMenu(buildTrayMenu(this._options.menuItems));
			return;
		}
		this._tray.setContextMenu(
			defaultTrayMenu({
				showWindow: () => this.focusMainWindow(),
				quit: () => this._options.onQuit?.() ?? console.log('Quit requested')
			})
		);
	}
}

export function createSystemTray(options?: SystemTrayOptions): SystemTray {
	const tray = new SystemTray(options);
	tray.create();
	return tray;
}
