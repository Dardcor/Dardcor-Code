/**
 * Dardcor Code - Terminal Visual Bell Flash Indicator
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { CssInjector } from '../../core/dom/css-injector.js';
import { TerminalEmulator } from './xterm-integration.js';

const TERMINAL_BELL_STYLE_ID = 'dc-terminal-bell-styles';

export interface ITerminalBellOptions {
	readonly enabled?: boolean;
	readonly color?: string;
	readonly durationMs?: number;
}

export class TerminalBell extends Disposable {
	private readonly _onBell = this._register(new Emitter<void>());
	readonly onBell: Event<void> = this._onBell.event;

	private readonly _emulator: TerminalEmulator;
	private readonly _view: HTMLElement;
	private _flashElement: HTMLElement | undefined;
	private _flashTimer: any = undefined;
	private _enabled: boolean;
	private _color: string;
	private _durationMs: number;

	constructor(emulator: TerminalEmulator, view: HTMLElement, options: ITerminalBellOptions = {}) {
		super();
		this._emulator = emulator;
		this._view = view;
		this._enabled = options.enabled ?? true;
		this._color = options.color ?? 'rgba(255, 255, 255, 0.35)';
		this._durationMs = options.durationMs ?? 180;

		CssInjector.inject(TERMINAL_BELL_STYLE_ID, `
			.dc-terminal-bell-flash { position: absolute; inset: 0; pointer-events: none; transition: opacity 120ms ease-out; z-index: 10; }
		`);

		this._register(this._emulator.onBell(() => this.flash()));
	}

	get enabled(): boolean {
		return this._enabled;
	}

	public setEnabled(enabled: boolean): void {
		this._enabled = enabled;
	}

	public flash(): void {
		if (!this._enabled || !this._view.isConnected) {
			return;
		}
		if (this._flashTimer) {
			clearTimeout(this._flashTimer);
		}
		if (!this._flashElement) {
			this._flashElement = $<HTMLElement>('div', 'dc-terminal-bell-flash');
			this._view.appendChild(this._flashElement);
		}
		this._flashElement.style.background = this._color;
		this._flashElement.style.opacity = '1';

		this._flashTimer = setTimeout(() => {
			if (this._flashElement) {
				this._flashElement.style.opacity = '0';
			}
		}, this._durationMs);
		this._onBell.fire();
	}

	public clear(): void {
		if (this._flashTimer) {
			clearTimeout(this._flashTimer);
			this._flashTimer = undefined;
		}
		if (this._flashElement) {
			this._flashElement.remove();
			this._flashElement = undefined;
		}
	}

	public dispose(): void {
		this.clear();
		super.dispose();
	}
}
