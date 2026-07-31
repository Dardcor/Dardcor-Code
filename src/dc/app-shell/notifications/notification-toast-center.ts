/**
 * Dardcor Code - Toast Notification Stacked Card Positioning
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $ } from '../../core/dom/element';
import { NotificationSeverity, INotification } from './notification-toast-widget';
import { NotificationActions, INotificationAction } from './notification-actions';

export interface INotificationToastCenterOptions {
	readonly maxVisible?: number;
	readonly defaultDuration?: number;
	readonly bottomOffset?: number;
}

interface IToastEntry {
	readonly id: string;
	readonly notification: INotification;
	readonly card: HTMLElement;
	readonly timer: ReturnType<typeof setTimeout>;
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

export class NotificationToastCenter extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _toasts = new Map<string, IToastEntry>();
	private readonly _queue: INotification[] = [];
	private readonly _maxVisible: number;
	private readonly _defaultDuration: number;

	private readonly _onDidDismiss = this._register(new Emitter<string>());
	readonly onDidDismiss: Event<string> = this._onDidDismiss.event;

	private readonly _onDidAction = this._register(new Emitter<{ id: string; actionId: string }>());
	readonly onDidAction: Event<{ id: string; actionId: string }> = this._onDidAction.event;

	constructor(
		parent: HTMLElement = document.body,
		options: INotificationToastCenterOptions = {}
	) {
		super();
		this._maxVisible = options.maxVisible ?? 4;
		this._defaultDuration = options.defaultDuration ?? 5000;

		this._container = $<HTMLElement>('div', 'dc-notification-toast-center');
		this._container.style.cssText = `position:fixed;bottom:${options.bottomOffset ?? 28}px;right:8px;z-index:1900;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none;`;
		parent.appendChild(this._container);
	}

	get container(): HTMLElement {
		return this._container;
	}

	get visibleCount(): number {
		return this._toasts.size;
	}

	get queueLength(): number {
		return this._queue.length;
	}

	show(notification: INotification): string {
		const id = notification.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		if (this._toasts.size >= this._maxVisible) {
			this._queue.push({ ...notification, id });
			return id;
		}
		this._showCard({ ...notification, id });
		return id;
	}

	dismiss(id: string): void {
		const entry = this._toasts.get(id);
		if (!entry) {
			return;
		}
		clearTimeout(entry.timer);
		entry.card.remove();
		this._toasts.delete(id);
		this._onDidDismiss.fire(id);
		this._pumpQueue();
	}

	clearAll(): void {
		for (const id of Array.from(this._toasts.keys())) {
			this.dismiss(id);
		}
		this._queue.length = 0;
	}

	clearQueue(): void {
		this._queue.length = 0;
	}

	getVisibleToasts(): INotification[] {
		return Array.from(this._toasts.values()).map(e => e.notification);
	}

	private _showCard(notification: INotification): void {
		const severity = notification.severity ?? NotificationSeverity.INFO;
		const duration = notification.duration ?? this._defaultDuration;

		const card = $<HTMLElement>('div', 'dc-toast-center-card');
		card.style.cssText = `pointer-events:auto;background:#333333;color:#cccccc;border:1px solid #454545;border-left:3px solid ${SEVERITY_COLOR[severity]};box-shadow:0 4px 12px rgba(0,0,0,0.4);width:340px;max-width:90vw;padding:10px 12px;font-family:Segoe UI, sans-serif;font-size:12px;opacity:0;transform:translateY(6px);transition:opacity 120ms ease, transform 120ms ease;`;
		card.dataset['toastId'] = notification.id;

		const header = $<HTMLElement>('div', 'dc-toast-center-header');
		header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
		const icon = $<HTMLElement>('span', 'dc-toast-center-icon');
		icon.textContent = SEVERITY_ICON[severity];
		icon.style.cssText = `color:${SEVERITY_COLOR[severity]};`;
		const source = $<HTMLElement>('span', 'dc-toast-center-source');
		source.textContent = notification.source ?? 'Notifications';
		source.style.cssText = 'font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const closeBtn = $<HTMLElement>('span', 'dc-toast-center-close');
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'cursor:pointer;color:#858585;padding:0 2px;font-size:11px;';
		closeBtn.addEventListener('click', () => this.dismiss(notification.id));
		header.appendChild(icon);
		header.appendChild(source);
		header.appendChild(closeBtn);
		card.appendChild(header);

		const message = $<HTMLElement>('div', 'dc-toast-center-message');
		message.textContent = notification.message;
		message.style.cssText = 'line-height:1.4;word-break:break-word;';
		card.appendChild(message);

		if (notification.actions && notification.actions.length > 0) {
			const actions = new NotificationActions(card);
			actions.onDidAction(actionId => this._onDidAction.fire({ id: notification.id, actionId }));
			actions.update(notification.actions);
		}

		const entry: IToastEntry = {
			id: notification.id,
			notification,
			card,
			timer: setTimeout(() => this.dismiss(notification.id), duration),
		};
		this._toasts.set(notification.id, entry);
		this._container.appendChild(card);

		card.addEventListener('mouseenter', () => {
			clearTimeout(entry.timer);
			(entry as { timer: ReturnType<typeof setTimeout> }).timer = setTimeout(() => {}, 0);
		});
		card.addEventListener('mouseleave', () => {
			clearTimeout(entry.timer);
			(entry as { timer: ReturnType<typeof setTimeout> }).timer = setTimeout(() => this.dismiss(notification.id), duration);
		});

		requestAnimationFrame(() => {
			card.style.opacity = '1';
			card.style.transform = 'translateY(0)';
		});
	}

	private _pumpQueue(): void {
		if (this._queue.length === 0 || this._toasts.size >= this._maxVisible) {
			return;
		}
		const next = this._queue.shift();
		if (next) {
			this._showCard(next);
		}
	}

	dispose(): void {
		for (const entry of this._toasts.values()) {
			clearTimeout(entry.timer);
		}
		this._toasts.clear();
		this._queue.length = 0;
		this._container.remove();
		super.dispose();
	}
}
