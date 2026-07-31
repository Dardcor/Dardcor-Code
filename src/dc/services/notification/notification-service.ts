/**
 * Dardcor Code - Notification Service Toast/Dialog Queue (Task 126)
 */

import { createDecorator } from '../instantiation/annotations.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { generateUuid } from '../../core/types/uuid.js';

export enum Severity {
	Info = 0,
	Warning = 1,
	Error = 2
}

export interface INotificationAction {
	readonly id: string;
	readonly label: string;
	run(): void | Promise<void>;
}

export interface INotification {
	readonly id: string;
	readonly severity: Severity;
	readonly message: string;
	readonly source?: string;
	readonly actions?: readonly INotificationAction[];
	readonly silent?: boolean;
}

export interface IConfirmNotificationOptions {
	readonly source?: string;
	readonly silent?: boolean;
	readonly onClose?: () => void;
}

export interface INotificationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeNotifications: Event<void>;
	notify(notification: Omit<INotification, 'id'>): void;
	info(message: string | Error, actions?: readonly INotificationAction[]): void;
	warning(message: string | Error, actions?: readonly INotificationAction[]): void;
	error(message: string | Error, actions?: readonly INotificationAction[]): void;
	prompt(severity: Severity, message: string, actions: readonly INotificationAction[], options?: IConfirmNotificationOptions): Promise<INotificationAction | undefined>;
	dismiss(id: string): void;
	dismissAll(): void;
	getNotifications(): readonly INotification[];
}

export const INotificationService = createDecorator<INotificationService>('notificationService');

export class NotificationService extends Disposable implements INotificationService {
	declare readonly _serviceBrand: undefined;

	private readonly _notifications: INotification[] = [];
	private readonly _closers = new Map<string, () => void>();

	private readonly _onDidChangeNotifications = this._register(new Emitter<void>());
	readonly onDidChangeNotifications = this._onDidChangeNotifications.event;

	public notify(notification: Omit<INotification, 'id'>): void {
		const id = generateUuid();
		this._notifications.push({ ...notification, id });
		this._onDidChangeNotifications.fire();
	}

	public info(message: string | Error, actions?: readonly INotificationAction[]): void {
		this.notify({ severity: Severity.Info, message: message instanceof Error ? message.message : message, actions });
	}

	public warning(message: string | Error, actions?: readonly INotificationAction[]): void {
		this.notify({ severity: Severity.Warning, message: message instanceof Error ? message.message : message, actions });
	}

	public error(message: string | Error, actions?: readonly INotificationAction[]): void {
		this.notify({ severity: Severity.Error, message: message instanceof Error ? message.message : message, actions });
	}

	public prompt(
		severity: Severity,
		message: string,
		actions: readonly INotificationAction[],
		options?: IConfirmNotificationOptions
	): Promise<INotificationAction | undefined> {
		return new Promise((resolve) => {
			const id = generateUuid();
			const wrappedActions = actions.map((action) => ({
				...action,
				run: () => {
					this._remove(id);
					resolve(action);
					return action.run();
				}
			}));
			this._notifications.push({
				id,
				severity,
				message,
				source: options?.source,
				silent: options?.silent,
				actions: wrappedActions
			});
			this._onDidChangeNotifications.fire();
			this._closers.set(id, () => {
				resolve(undefined);
				options?.onClose?.();
			});
		});
	}

	public dismiss(id: string): void {
		if (this._remove(id)) {
			this._onDidChangeNotifications.fire();
		}
	}

	public dismissAll(): void {
		if (this._notifications.length === 0) {
			return;
		}
		for (const [id, closer] of this._closers) {
			closer();
			this._closers.delete(id);
		}
		this._notifications.length = 0;
		this._onDidChangeNotifications.fire();
	}

	public getNotifications(): readonly INotification[] {
		return this._notifications;
	}

	private _remove(id: string): boolean {
		const index = this._notifications.findIndex((n) => n.id === id);
		if (index < 0) {
			return false;
		}
		this._notifications.splice(index, 1);
		const closer = this._closers.get(id);
		if (closer) {
			this._closers.delete(id);
		}
		return true;
	}
}
