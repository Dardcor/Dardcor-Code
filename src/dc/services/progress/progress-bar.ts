/**
 * Dardcor Code - Animated Progress Bar Controller (Task 171)
 * Mirrors: vs/base/browser/ui/progressbar/progressbar.ts + IProgressService renderer hook
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { IProgressService, IProgressState } from './progress-service.js';

export interface IProgressBar {
	readonly onDidStop: Event<void>;
	infinite(): void;
	total(value: number): void;
	stop(): void;
}

export class ProgressBar extends Disposable implements IProgressBar, IDisposable {
	private readonly _el: HTMLElement;
	private readonly _fill: HTMLElement;

	private _active = false;
	private _percent = 0;
	private _animationId: number | null = null;
	private _lastRender: IProgressState[] = [];

	private readonly _onDidStop = this._register(new Emitter<void>());
	readonly onDidStop: Event<void> = this._onDidStop.event;

	constructor(
		container: HTMLElement,
		private readonly _progressService?: IProgressService
	) {
		super();

		this._el = document.createElement('div');
		this._el.className = 'dc-progress-bar';
		this._el.style.position = 'relative';
		this._el.style.height = '2px';
		this._el.style.width = '100%';
		this._el.style.overflow = 'hidden';
		this._el.style.display = 'none';
		this._el.style.background = 'rgba(128, 128, 128, 0.2)';
		container.appendChild(this._el);

		this._fill = document.createElement('div');
		this._fill.className = 'dc-progress-bar-fill';
		this._fill.style.position = 'absolute';
		this._fill.style.top = '0';
		this._fill.style.left = '0';
		this._fill.style.height = '100%';
		this._fill.style.width = '0%';
		this._fill.style.background = 'linear-gradient(to right, #007acc, #0098ff)';
		this._fill.style.transition = 'width 120ms linear';
		this._el.appendChild(this._fill);

		if (this._progressService) {
			this._register(this._progressService.setProgressRenderer((states) => this._renderStates(states)));
		}
	}

	public infinite(): void {
		this._active = true;
		this._el.style.display = 'block';
		this._fill.style.width = '100%';
		this._fill.style.background = 'linear-gradient(90deg, transparent, #007acc 40%, #0098ff 50%, #007acc 60%, transparent)';
		this._fill.style.animation = 'dc-progress-indeterminate 1.2s linear infinite';
	}

	public total(value: number): void {
		this._active = true;
		this._percent = Math.min(100, Math.max(0, value));
		this._el.style.display = 'block';
		this._fill.style.background = 'linear-gradient(to right, #007acc, #0098ff)';
		this._fill.style.animation = '';
		this._fill.style.width = `${this._percent}%`;
	}

	public stop(): void {
		if (!this._active) {
			return;
		}
		this._active = false;
		this._el.style.display = 'none';
		this._fill.style.animation = '';
		this._fill.style.width = '0%';
		if (this._animationId !== null) {
			globalThis.cancelAnimationFrame(this._animationId);
			this._animationId = null;
		}
		this._onDidStop.fire();
	}

	private _renderStates(states: readonly IProgressState[]): void {
		this._lastRender = [...states];
		const active = states.filter((s) => s.active);
		if (active.length === 0) {
			this.stop();
			return;
		}
		const withPercent = active.filter((s) => s.percent !== undefined);
		if (withPercent.length > 0) {
			const avg = withPercent.reduce((sum, s) => sum + (s.percent ?? 0), 0) / withPercent.length;
			this.total(avg);
		} else {
			this.infinite();
		}
	}

	dispose(): void {
		if (this._animationId !== null) {
			globalThis.cancelAnimationFrame(this._animationId);
			this._animationId = null;
		}
		this._el.remove();
		super.dispose();
	}
}

export function createProgressBar(container: HTMLElement, progressService?: IProgressService): IDisposable & IProgressBar {
	return new ProgressBar(container, progressService);
}
