/**
 * Dardcor Code - DOM Toast Widget (Task 192)
 * Mirrors: vs/workbench/browser/parts/notifications/notificationsToasts.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { NotificationModel } from './notification-model.js';
import { Severity } from './notification-service.js';


export class ToastWidget implements IDisposable {
	private readonly _el: HTMLElement;

	constructor(container: HTMLElement, public readonly model: NotificationModel) {
		this._el = document.createElement('div');
		this._el.className = 'dc-toast-widget';
		this._el.style.padding = '8px 12px';
		this._el.style.margin = '6px 0';
		this._el.style.borderRadius = '4px';
		this._el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
		this._el.style.display = 'flex';
		this._el.style.alignItems = 'center';
		this._el.style.justifyContent = 'space-between';

		// Apply theme colors based on severity
		switch (model.severity) {
			case Severity.Error:
				this._el.style.background = '#5a1d1d';
				this._el.style.color = '#ffffff';
				break;
			case Severity.Warning:
				this._el.style.background = '#5a461d';
				this._el.style.color = '#ffffff';
				break;
			default:
				this._el.style.background = '#252526';
				this._el.style.color = '#cccccc';
				break;
		}

		const msgSpan = document.createElement('span');
		msgSpan.innerText = model.message;
		this._el.appendChild(msgSpan);

		const closeBtn = document.createElement('button');
		closeBtn.innerText = '×';
		closeBtn.style.background = 'transparent';
		closeBtn.style.border = 'none';
		closeBtn.style.color = 'inherit';
		closeBtn.style.fontSize = '16px';
		closeBtn.style.cursor = 'pointer';
		closeBtn.onclick = () => this.dispose();
		this._el.appendChild(closeBtn);

		container.appendChild(this._el);
	}

	dispose(): void {
		this._el.remove();
	}
}
