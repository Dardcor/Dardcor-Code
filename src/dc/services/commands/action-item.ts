/**
 * Dardcor Code - Toolbar Action Item (Task 172)
 * Mirrors: vs/base/browser/ui/actionbar/actionbar.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IAction {
	readonly id: string;
	readonly label: string;
	readonly tooltip?: string;
	readonly class?: string;
	readonly enabled: boolean;
	readonly checked?: boolean;
	run(...args: any[]): Promise<any>;
}

export class ActionItem implements IDisposable {
	private readonly _el: HTMLElement;
	private readonly _onDidRun = new Emitter<void>();
	readonly onDidRun: Event<void> = this._onDidRun.event;

	constructor(container: HTMLElement, public readonly action: IAction) {
		this._el = document.createElement('div');
		this._el.className = `dc-action-item ${action.class ?? ''}`;
		this._el.title = action.tooltip ?? action.label;
		this._el.innerText = action.label;
		this._el.style.cursor = action.enabled ? 'pointer' : 'default';
		this._el.style.opacity = action.enabled ? '1' : '0.5';

		this._el.addEventListener('click', async (e) => {
			e.preventDefault();
			if (!this.action.enabled) return;
			await this.action.run();
			this._onDidRun.fire();
		});

		container.appendChild(this._el);
	}

	dispose(): void {
		this._el.remove();
		this._onDidRun.dispose();
	}
}
