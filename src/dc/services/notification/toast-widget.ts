/**
 * Dardcor Code - DOM Toast Element Renderer (Task 192)
 * Mirrors: vs/workbench/browser/parts/notifications/notificationsToasts.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { NotificationModel } from './notification-model';
import { Severity } from './notification-service';

export interface IToastWidgetOptions {
	readonly autoHideDelayMs?: number;
	readonly onAction?: (id: string) => void;
}

const DEFAULT_AUTO_HIDE = 5000;

export class ToastWidget extends Disposable {
	private readonly _el: HTMLElement;
	private readonly _onDidClose = this._register(new Emitter<ToastWidget>());
	private _hideTimer: ReturnType<typeof setTimeout> | null = null;

	readonly onDidClose: Event<ToastWidget> = this._onDidClose.event;

	constructor(
		container: HTMLElement,
		public readonly model: NotificationModel,
		private readonly _options: IToastWidgetOptions = {}
	) {
		super();
		this._el = document.createElement('div');
		this._el.className = `dc-toast-widget severity-${severityClass(model.severity)}`;
		this._el.setAttribute('role', severityClass(model.severity) === 'error' ? 'alert' : 'status');
		this._el.style.padding = '8px 12px';
		this._el.style.margin = '6px 0';
		this._el.style.borderRadius = '4px';
		this._el.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.35)';
		this._el.style.display = 'flex';
		this._el.style.alignItems = 'center';
		this._el.style.justifyContent = 'space-between';
		this._el.style.gap = '12px';
		this._el.style.maxWidth = '420px';
		this._el.style.animation = 'dc-toast-in 150ms ease-out';

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
		msgSpan.style.flex = '1';
		this._el.appendChild(msgSpan);

		if (model.actions && model.actions.length > 0) {
			const actionsBar = document.createElement('div');
			actionsBar.style.display = 'flex';
			actionsBar.style.gap = '8px';
			for (const action of model.actions) {
				const btn = document.createElement('button');
				btn.innerText = action.label;
				btn.style.background = 'rgba(255, 255, 255, 0.15)';
				btn.style.border = 'none';
				btn.style.color = 'inherit';
				btn.style.padding = '2px 8px';
				btn.style.borderRadius = '3px';
				btn.style.cursor = 'pointer';
				btn.onclick = () => {
					this._options.onAction?.(action.id);
					action.run();
				};
				actionsBar.appendChild(btn);
			}
			this._el.appendChild(actionsBar);
		}

		const closeBtn = document.createElement('button');
		closeBtn.innerText = '×';
		closeBtn.setAttribute('aria-label', 'Dismiss notification');
		closeBtn.style.background = 'transparent';
		closeBtn.style.border = 'none';
		closeBtn.style.color = 'inherit';
		closeBtn.style.fontSize = '16px';
		closeBtn.style.cursor = 'pointer';
		closeBtn.onclick = () => this.close();
		this._el.appendChild(closeBtn);

		container.appendChild(this._el);
		this._scheduleAutoHide();
	}

	get element(): HTMLElement {
		return this._el;
	}

	close(): void {
		if (this._hideTimer !== null) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
		this._onDidClose.fire(this);
		this.dispose();
	}

	override dispose(): void {
		if (this._hideTimer !== null) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
		this._el.remove();
		super.dispose();
	}

	private _scheduleAutoHide(): void {
		const delay = this._options.autoHideDelayMs ?? (this.model.severity === Severity.Error ? 0 : DEFAULT_AUTO_HIDE);
		if (delay > 0) {
			this._hideTimer = setTimeout(() => this.close(), delay);
		}
	}
}

function severityClass(severity: Severity): string {
	switch (severity) {
		case Severity.Error:
			return 'error';
		case Severity.Warning:
			return 'warning';
		default:
			return 'info';
	}
}
