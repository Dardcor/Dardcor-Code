/**
 * Dardcor Code - Bottom-Right Floating Alert Toast Card Widget
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { $ } from '../../core/dom/element.js';
import { NotificationActions, INotificationAction } from './notification-actions.js';

export const enum NotificationSeverity {
	INFO = 0,
	WARNING = 1,
	ERROR = 2,
}

export interface INotification {
	readonly id: string;
	message: string;
	severity?: NotificationSeverity;
	source?: string;
	actions?: INotificationAction[];
	duration?: number;
}

const SEVERITY_ICON: Record<NotificationSeverity, string> = {
	[NotificationSeverity.INFO]: '\u2139',
	[NotificationSeverity.WARNING]: '\u26a0',
	[NotificationSeverity.ERROR]: '\u2715',
};

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
	[NotificationSeverity.INFO]: '#75beff',
	[NotificationSeverity.WARNING]: '#cca700',
	[NotificationSeverity.ERROR]: '#f48771',
};

const DEFAULT_DURATION = 5000;

export class NotificationToastWidget extends Disposable {
	private readonly _container: HTMLElement;
	private _card: HTMLElement | null = null;
	private _timer: ReturnType<typeof setTimeout> | null = null;
	private readonly _onDidClose = this._register(new Emitter<string>());
	readonly onDidClose: Event<string> = this._onDidClose.event;

	constructor(parent: HTMLElement = document.body) {
		super();
		this._container = $<HTMLElement>('div', 'dc-notification-toast-container');
		this._container.style.cssText = 'position:fixed;bottom:28px;right:8px;z-index:1900;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;';
		parent.appendChild(this._container);
	}

	get isShowing(): boolean {
		return this._card !== null;
	}

	show(notification: INotification): void {
		this._card?.remove();
		const severity = notification.severity ?? NotificationSeverity.INFO;
		const card = $<HTMLElement>('div', 'dc-notification-toast');
		card.style.cssText = 'pointer-events:auto;background:#333333;color:#cccccc;border:1px solid #454545;border-left:3px solid ' + SEVERITY_COLOR[severity] + ';box-shadow:0 4px 12px rgba(0,0,0,0.4);width:340px;max-width:90vw;padding:10px 12px;font-family:Segoe UI, sans-serif;font-size:12px;';
		this._card = card;
		card.dataset['notificationId'] = notification.id;

		const header = $<HTMLElement>('div', 'dc-notification-toast-header');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
		const icon = $<HTMLElement>('span', 'dc-notification-toast-icon');
		icon.textContent = SEVERITY_ICON[severity];
		icon.style.cssText = 'color:' + SEVERITY_COLOR[severity] + ';';
		const source = $<HTMLElement>('span', 'dc-notification-toast-source');
		source.textContent = notification.source ?? '';
		source.style.cssText = 'font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const closeBtn = $<HTMLElement>('span', 'dc-notification-toast-close');
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'cursor:pointer;color:#858585;padding:0 2px;font-size:11px;';
		closeBtn.addEventListener('click', () => this._close(notification.id));
		header.appendChild(icon);
		header.appendChild(source);
		header.appendChild(closeBtn);
		card.appendChild(header);

		const message = $<HTMLElement>('div', 'dc-notification-toast-message');
		message.textContent = notification.message;
		message.style.cssText = 'line-height:1.4;word-break:break-word;';
		card.appendChild(message);

		if (notification.actions && notification.actions.length > 0) {
			const actions = new NotificationActions(card);
			actions.update(notification.actions);
		}

		this._container.appendChild(card);
		this._scheduleClose(notification.id, notification.duration ?? DEFAULT_DURATION);
	}

	clear(): void {
		if (this._card) {
			const id = this._card.dataset['notificationId'];
			this._close(id ?? '');
		}
	}

	private _scheduleClose(id: string, duration: number): void {
		if (this._timer) {
			clearTimeout(this._timer);
		}
		this._timer = setTimeout(() => this._close(id), duration);
	}

	private _close(id: string): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		this._card?.remove();
		this._card = null;
		this._onDidClose.fire(id);
	}

	dispose(): void {
		if (this._timer) {
			clearTimeout(this._timer);
			this._timer = null;
		}
		this._container.remove();
		super.dispose();
	}
}
