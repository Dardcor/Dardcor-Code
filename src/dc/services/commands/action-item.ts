/**
 * Dardcor Code - Toolbar Icon Button Action Item (Task 172)
 * Mirrors: vs/base/browser/ui/actionbar/actionbar.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export interface IAction {
	readonly id: string;
	readonly label: string;
	readonly tooltip?: string;
	readonly class?: string;
	readonly enabled: boolean;
	readonly checked?: boolean;
	run(...args: any[]): Promise<any>;
}

export class ActionItem extends Disposable {
	private readonly _el: HTMLElement;
	private readonly _onDidRun = this._register(new Emitter<void>());
	private readonly _onDidChangeEnabled = this._register(new Emitter<void>());
	private readonly _onDidChangeChecked = this._register(new Emitter<void>());

	readonly onDidRun: Event<void> = this._onDidRun.event;
	readonly onDidChangeEnabled: Event<void> = this._onDidChangeEnabled.event;
	readonly onDidChangeChecked: Event<void> = this._onDidChangeChecked.event;

	constructor(container: HTMLElement, public readonly action: IAction) {
		super();
		this._el = document.createElement('div');
		this._el.className = `dc-action-item ${action.class ?? ''}`;
		this._el.setAttribute('role', 'button');
		this._el.setAttribute('aria-label', action.tooltip ?? action.label);
		this._el.title = action.tooltip ?? action.label;
		this._el.innerText = action.label;

		this._applyState();

		this._el.addEventListener('click', async (e) => {
			e.preventDefault();
			if (!this.action.enabled) {
				return;
			}
			await this.action.run();
			this._onDidRun.fire();
		});

		container.appendChild(this._el);
	}

	get element(): HTMLElement {
		return this._el;
	}

	setEnabled(enabled: boolean): void {
		if (this.action.enabled === enabled) {
			return;
		}
		(this.action as { enabled: boolean }).enabled = enabled;
		this._applyState();
		this._onDidChangeEnabled.fire();
	}

	setChecked(checked: boolean): void {
		if (this.action.checked === checked) {
			return;
		}
		(this.action as { checked?: boolean }).checked = checked;
		this._applyState();
		this._onDidChangeChecked.fire();
	}

	override dispose(): void {
		this._el.remove();
		super.dispose();
	}

	private _applyState(): void {
		this._el.style.cursor = this.action.enabled ? 'pointer' : 'default';
		this._el.style.opacity = this.action.enabled ? '1' : '0.5';
		this._el.setAttribute('aria-disabled', String(!this.action.enabled));
		this._el.classList.toggle('checked', !!this.action.checked);
	}
}
