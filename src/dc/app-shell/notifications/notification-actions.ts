/**
 * Dardcor Code - Primary & Secondary Notification Action Button Bar
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $, clearNode } from '../../core/dom/element.js';

export interface INotificationAction {
	readonly id: string;
	readonly label: string;
	readonly kind?: 'primary' | 'secondary';
	run(): void;
}

export class NotificationActions extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _onDidAction = this._register(new Emitter<string>());
	readonly onDidAction: Event<string> = this._onDidAction.event;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-notification-actions');
		this._container.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
		parent.appendChild(this._container);
	}

	update(actions: INotificationAction[]): void {
		clearNode(this._container);
		for (const action of actions) {
			const btn = $<HTMLButtonElement>('button', 'dc-notification-action');
			btn.textContent = action.label;
			btn.style.cssText = 'border:none;padding:3px 12px;font-size:12px;font-family:Segoe UI, sans-serif;cursor:pointer;color:#ffffff;' +
				(action.kind === 'primary'
					? 'background:#0e639c;'
					: 'background:#3c3c3c;');
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				this._onDidAction.fire(action.id);
				action.run();
			});
			this._container.appendChild(btn);
		}
	}

	clear(): void {
		clearNode(this._container);
	}

	get element(): HTMLElement {
		return this._container;
	}
}
