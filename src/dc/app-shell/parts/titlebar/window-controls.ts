/**
 * Dardcor Code - Custom Minimize, Maximize & Close Window Action Buttons
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { getElectronIPC } from '../../../core/ipc/electron-bridge.js';

export type WindowControlKind = 'minimize' | 'maximize' | 'close';

export interface IWindowControlsOptions {
	readonly draggable?: boolean;
	readonly onMinimize?: () => void;
	readonly onMaximize?: () => void;
	readonly onClose?: () => void;
}

const MINIMIZE_ICON = '\u2013';
const MAXIMIZE_ICON = '\u25a1';
const RESTORE_ICON = '\u2750';
const CLOSE_ICON = '\u2715';

export class WindowControls extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _buttons = new Map<WindowControlKind, HTMLElement>();
	private _maximized = false;
	private readonly _ipc = getElectronIPC();

	private readonly _onDidClick = this._register(new Emitter<WindowControlKind>());
	readonly onDidClick: Event<WindowControlKind> = this._onDidClick.event;

	constructor(
		parent: HTMLElement,
		private readonly _options: IWindowControlsOptions = {}
	) {
		super();
		this._container = $<HTMLElement>('div', 'dc-window-controls');
		this._container.style.cssText = 'display:flex;align-items:center;flex-shrink:0;height:100%;';
		if (this._options.draggable !== false) {
			(this._container.style as unknown as { webkitAppRegion: string }).webkitAppRegion = 'no-drag';
		}
		parent.appendChild(this._container);
		this._buildButtons();
	}

	get element(): HTMLElement {
		return this._container;
	}

	get isMaximized(): boolean {
		return this._maximized;
	}

	setMaximized(maximized: boolean): void {
		if (this._maximized === maximized) {
			return;
		}
		this._maximized = maximized;
		const button = this._buttons.get('maximize');
		if (button) {
			button.textContent = maximized ? RESTORE_ICON : MAXIMIZE_ICON;
			button.title = maximized ? 'Restore Down' : 'Maximize';
		}
	}

	private _buildButtons(): void {
		const specs: { kind: WindowControlKind; icon: string; title: string; hover: string }[] = [
			{ kind: 'minimize', icon: MINIMIZE_ICON, title: 'Minimize', hover: '#4a4a4a' },
			{ kind: 'maximize', icon: MAXIMIZE_ICON, title: 'Maximize', hover: '#4a4a4a' },
			{ kind: 'close', icon: CLOSE_ICON, title: 'Close', hover: '#e81123' },
		];
		for (const spec of specs) {
			const btn = $<HTMLElement>('div', 'dc-window-control');
			btn.textContent = spec.icon;
			btn.title = spec.title;
			btn.dataset['controlKind'] = spec.kind;
			btn.style.cssText = 'width:46px;height:100%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#cccccc;user-select:none;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = spec.hover;
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this._handleClick(spec.kind);
			});
			this._buttons.set(spec.kind, btn);
			this._container.appendChild(btn);
		}
	}

	private _handleClick(kind: WindowControlKind): void {
		switch (kind) {
			case 'minimize':
				if (this._ipc.isAvailable) {
					void this._ipc.invoke('window:minimize').catch(() => this._options.onMinimize?.());
				} else {
					this._options.onMinimize?.();
				}
				break;
			case 'maximize':
				if (this._ipc.isAvailable) {
					void this._ipc.invoke('window:maximizeToggle').then((maximized: unknown) => {
						this.setMaximized(maximized === true);
					}).catch(() => this._options.onMaximize?.());
				} else {
					this.setMaximized(!this._maximized);
					this._options.onMaximize?.();
				}
				break;
			case 'close':
				if (this._ipc.isAvailable) {
					void this._ipc.invoke('window:close').catch(() => this._options.onClose?.());
				} else {
					this._options.onClose?.();
				}
				break;
		}
		this._onDidClick.fire(kind);
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
