/**
 * Dardcor Code - Notification Model (Task 164)
 * Mirrors: vs/platform/notification/common/notification.ts notification model
 */

import { Severity, INotificationAction } from './notification-service.js';


export class NotificationModel {
	readonly id: number;
	private _severity: Severity;
	private _message: string;
	readonly source?: string;
	readonly actions: INotificationAction[];

	constructor(
		id: number,
		severity: Severity,
		message: string,
		source?: string,
		actions: INotificationAction[] = []
	) {
		this.id = id;
		this._severity = severity;
		this._message = message;
		this.source = source;
		this.actions = actions;
	}

	get severity(): Severity { return this._severity; }
	set severity(value: Severity) { this._severity = value; }

	get message(): string { return this._message; }
	set message(value: string) { this._message = value; }
}
