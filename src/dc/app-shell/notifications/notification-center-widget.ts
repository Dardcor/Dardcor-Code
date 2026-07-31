/**
 * Dardcor Code - Bell Notification Drawer Panel Widget
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode } from '../../core/dom/element';
import { NotificationActions, INotificationAction } from './notification-actions';
import { NotificationSeverity, INotification } from './notification-toast-widget';

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

export interface INotificationCenterEntry extends INotification {
	readonly timestamp: number;
}

export class NotificationCenterWidget extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _drawer: HTMLElement;
	private readonly _list: HTMLElement;
	private readonly _badgeEl: HTMLElement;
	private readonly _notifications = new Map<string, INotificationCenterEntry>();
	private _isOpen = false;
	private _unseenCount = 0;

	private readonly _onDidClose = this._register(new Emitter<void>());
	private readonly _onDidClear = this._register(new Emitter<void>());
	private readonly _onDidAction = this._register(new Emitter<{ id: string; actionId: string }>());
	private readonly _onDidChangeBadge = this._register(new Emitter<number>());

	readonly onDidClose: Event<void> = this._onDidClose.event;
	readonly onDidClear: Event<void> = this._onDidClear.event;
	readonly onDidAction: Event<{ id: string; actionId: string }> = this._onDidAction.event;
	readonly onDidChangeBadge: Event<number> = this._onDidChangeBadge.event;

	constructor(private readonly _anchor: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-notification-center-container');
		this._container.style.cssText = 'position:fixed;right:8px;z-index:1900;display:none;font-family:Segoe UI, sans-serif;font-size:12px;color:#cccccc;';
		this._drawer = $<HTMLElement>('div', 'dc-notification-center');
		this._drawer.style.cssText = 'background:#252526;border:1px solid #3c3c3c;box-shadow:0 6px 16px rgba(0,0,0,0.4);width:380px;max-width:90vw;max-height:70vh;display:flex;flex-direction:column;';

		const header = $<HTMLElement>('div', 'dc-notification-center-header');
		header.style.cssText = 'display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #3c3c3c;';
		const title = $<HTMLElement>('span', 'dc-notification-center-title');
		title.textContent = 'Notifications';
		title.style.cssText = 'flex:1;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#bbbbbb;';
		this._badgeEl = $<HTMLElement>('span', 'dc-notification-center-badge');
		this._badgeEl.style.cssText = 'background:#0e639c;border-radius:10px;padding:0 8px;font-size:11px;color:#ffffff;margin-right:10px;display:none;';
		const clearAll = $<HTMLElement>('span', 'dc-notification-center-clear');
		clearAll.textContent = 'Clear All';
		clearAll.style.cssText = 'cursor:pointer;color:#75beff;font-size:12px;';
		clearAll.addEventListener('click', () => this.clearAll());
		header.appendChild(title);
		header.appendChild(this._badgeEl);
		header.appendChild(clearAll);
		this._drawer.appendChild(header);

		this._list = $<HTMLElement>('div', 'dc-notification-center-list');
		this._list.style.cssText = 'overflow-y:auto;flex:1;';
		this._drawer.appendChild(this._list);
		this._container.appendChild(this._drawer);

		document.body.appendChild(this._container);

		const anchorRect = () => this._anchor.getBoundingClientRect();
		requestAnimationFrame(() => {
			this._container.style.top = `${anchorRect().bottom + 6}px`;
		});
	}

	get isOpen(): boolean {
		return this._isOpen;
	}

	get badgeCount(): number {
		return this._unseenCount;
	}

	add(notification: INotification): string {
		const id = notification.id || `notification-${Date.now()}`;
		this._notifications.set(id, { ...notification, id, timestamp: Date.now() });
		this._unseenCount++;
		this._updateBadge();
		this._renderList();
		return id;
	}

	remove(id: string): void {
		if (this._notifications.delete(id)) {
			this._renderList();
		}
	}

	clearAll(): void {
		this._notifications.clear();
		this._unseenCount = 0;
		this._updateBadge();
		this._renderList();
		this._onDidClear.fire();
	}

	open(): void {
		this._isOpen = true;
		this._unseenCount = 0;
		this._updateBadge();
		this._renderList();
		this._container.style.display = 'block';
		this._registerOutsideClick();
	}

	close(): void {
		this._isOpen = false;
		this._container.style.display = 'none';
		this._onDidClose.fire();
	}

	toggle(): void {
		if (this._isOpen) {
			this.close();
		} else {
			this.open();
		}
	}

	getNotifications(): INotificationCenterEntry[] {
		return Array.from(this._notifications.values()).sort((a, b) => b.timestamp - a.timestamp);
	}

	private _registerOutsideClick(): void {
		const onMouseDown = (e: MouseEvent) => {
			if (!this._container.contains(e.target as Node) && !this._anchor.contains(e.target as Node)) {
				document.removeEventListener('mousedown', onMouseDown);
				this.close();
			}
		};
		document.addEventListener('mousedown', onMouseDown);
	}

	private _updateBadge(): void {
		this._badgeEl.textContent = `${this._unseenCount}`;
		this._badgeEl.style.display = this._unseenCount > 0 ? 'inline-block' : 'none';
		this._onDidChangeBadge.fire(this._unseenCount);
	}

	private _renderList(): void {
		clearNode(this._list);
		const entries = this.getNotifications();
		if (entries.length === 0) {
			const empty = $<HTMLElement>('div', 'dc-notification-center-empty');
			empty.textContent = 'No notifications';
			empty.style.cssText = 'padding:20px;text-align:center;color:#858585;';
			this._list.appendChild(empty);
			return;
		}
		for (const entry of entries) {
			const row = $<HTMLElement>('div', 'dc-notification-center-row');
			row.style.cssText = 'padding:10px 12px;border-bottom:1px solid #2a2a2a;cursor:default;';
			const header = $<HTMLElement>('div', 'dc-notification-center-row-header');
			header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';
			const icon = $<HTMLElement>('span', 'dc-notification-center-row-icon');
			icon.textContent = SEVERITY_ICON[entry.severity ?? NotificationSeverity.INFO];
			icon.style.cssText = 'color:' + SEVERITY_COLOR[entry.severity ?? NotificationSeverity.INFO] + ';';
			const source = $<HTMLElement>('span', 'dc-notification-center-row-source');
			source.textContent = entry.source ?? 'Notifications';
			source.style.cssText = 'font-weight:600;flex:1;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#bbbbbb;';
			const time = $<HTMLElement>('span', 'dc-notification-center-row-time');
			time.textContent = new Date(entry.timestamp).toLocaleTimeString();
			time.style.cssText = 'color:#858585;font-size:11px;';
			header.appendChild(icon);
			header.appendChild(source);
			header.appendChild(time);
			row.appendChild(header);

			const message = $<HTMLElement>('div', 'dc-notification-center-row-message');
			message.textContent = entry.message;
			message.style.cssText = 'line-height:1.4;word-break:break-word;';
			row.appendChild(message);

			if (entry.actions && entry.actions.length > 0) {
				const actions = new NotificationActions(row);
				actions.onDidAction(actionId => this._onDidAction.fire({ id: entry.id, actionId }));
				actions.update(entry.actions);
			}
			this._list.appendChild(row);
		}
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
