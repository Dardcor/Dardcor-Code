/**
 * Dardcor Code - Progress Bar (Task 171)
 * Mirrors: vs/base/browser/ui/progressbar/progressbar.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';

export class ProgressBar implements IDisposable {
	private readonly _el: HTMLElement;
	private _active = false;

	constructor(container: HTMLElement) {
		this._el = document.createElement('div');
		this._el.className = 'dc-progress-bar';
		this._el.style.height = '2px';
		this._el.style.width = '100%';
		this._el.style.position = 'absolute';
		this._el.style.top = '0';
		this._el.style.left = '0';
		this._el.style.display = 'none';
		this._el.style.background = 'linear-gradient(to right, #007acc, #0098ff)';
		container.appendChild(this._el);
	}

	infinite(): void {
		this._active = true;
		this._el.style.display = 'block';
		this._el.classList.add('infinite');
	}

	total(value: number): void {
		this._active = true;
		this._el.style.display = 'block';
		this._el.style.width = `${Math.min(100, Math.max(0, value))}%`;
	}

	stop(): void {
		this._active = false;
		this._el.style.display = 'none';
		this._el.classList.remove('infinite');
	}

	dispose(): void {
		this._el.remove();
	}
}
