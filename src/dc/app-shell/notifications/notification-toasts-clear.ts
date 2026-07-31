/**
 * Dardcor Code - Clear All Action Handler Inside Notification Center
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { NotificationCenterWidget } from './notification-center-widget.js';
import { NotificationToastCenter } from './notification-toast-center.js';

export interface INotificationToastsClearOptions {
	readonly clearCenter?: boolean;
	readonly clearToasts?: boolean;
	readonly confirmOnClear?: boolean;
}

export interface INotificationClearEvent {
	readonly centerCount: number;
	readonly toastCount: number;
	readonly source: 'center' | 'toast' | 'external';
}

export class NotificationToastsClear extends Disposable {
	private readonly _center: NotificationCenterWidget;
	private readonly _toastCenter: NotificationToastCenter | null;
	private readonly _options: INotificationToastsClearOptions;

	private readonly _onDidClear = this._register(new Emitter<INotificationClearEvent>());
	readonly onDidClear: Event<INotificationClearEvent> = this._onDidClear.event;

	constructor(
		center: NotificationCenterWidget,
		toastCenter: NotificationToastCenter | null = null,
		options: INotificationToastsClearOptions = {}
	) {
		super();
		this._center = center;
		this._toastCenter = toastCenter;
		this._options = options;

		this._register(center.onDidClear(() => this._onCenterCleared()));
		if (toastCenter) {
			this._register(toastCenter.onDidDismiss(() => this._onToastDismissed()));
		}
	}

	get centerCount(): number {
		return this._center.getNotifications().length;
	}

	get toastCount(): number {
		return this._toastCenter?.visibleCount ?? 0;
	}

	clearAll(source: 'center' | 'toast' | 'external' = 'external'): void {
		if (this._options.confirmOnClear && source !== 'center') {
			return;
		}
		const centerCount = this.centerCount;
		const toastCount = this.toastCount;

		if (this._options.clearCenter !== false) {
			this._center.clearAll();
		}
		if (this._options.clearToasts !== false && this._toastCenter) {
			this._toastCenter.clearAll();
		}

		this._onDidClear.fire({ centerCount, toastCount, source });
	}

	clearToasts(): void {
		if (this._toastCenter) {
			this._toastCenter.clearAll();
		}
	}

	clearCenter(): void {
		this._center.clearAll();
	}

	private _onCenterCleared(): void {
		const toastCount = this.toastCount;
		if (this._options.clearToasts !== false && this._toastCenter) {
			this._toastCenter.clearAll();
		}
		this._onDidClear.fire({ centerCount: 0, toastCount, source: 'center' });
	}

	private _onToastDismissed(): void {
		if (this.toastCount === 0) {
			this._onDidClear.fire({ centerCount: this.centerCount, toastCount: 0, source: 'toast' });
		}
	}

	dispose(): void {
		super.dispose();
	}
}
