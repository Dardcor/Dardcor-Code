/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationsModel, INotificationChangeEvent, NotificationChangeType, IStatusMessageChangeEvent, StatusMessageChangeType, IStatusMessageViewItem, NotificationsPosition, NotificationsSettings, getNotificationsPosition } from '../../../common/notifications.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor, IStatusbarEntry } from '../../../services/statusbar/browser/statusbar.js';
import { Disposable, IDisposable, dispose } from '../../../../base/common/lifecycle.js';
import { HIDE_NOTIFICATIONS_CENTER, SHOW_NOTIFICATIONS_CENTER } from './notificationsCommands.js';
import { localize } from '../../../../nls.js';
import { INotificationService, NotificationsFilter } from '../../../../platform/notification/common/notification.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export class NotificationsStatus extends Disposable {

	private notificationsCenterStatusItem: IStatusbarEntryAccessor | undefined;
	private newNotificationsCount = 0;

	private currentStatusMessage: [IStatusMessageViewItem, IDisposable] | undefined;

	private isNotificationsCenterVisible: boolean = false;
	private isNotificationsToastsVisible: boolean = false;

	private currentAlignment: StatusbarAlignment | undefined;

	constructor(
		private readonly model: INotificationsModel,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this.updateNotificationsCenterStatusItem();

		if (model.statusMessage) {
			this.doSetStatusMessage(model.statusMessage);
		}

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.model.onDidChangeNotification(e => this.onDidChangeNotification(e)));
		this._register(this.model.onDidChangeStatusMessage(e => this.onDidChangeStatusMessage(e)));
		this._register(this.notificationService.onDidChangeFilter(() => this.updateNotificationsCenterStatusItem()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(NotificationsSettings.NOTIFICATIONS_POSITION)) {
				this.updateNotificationsCenterStatusItem();
			}
		}));
	}

	private onDidChangeNotification(e: INotificationChangeEvent): void {

		if (!this.isNotificationsCenterVisible) {
			if (e.kind === NotificationChangeType.ADD) {
				this.newNotificationsCount++;
			} else if (e.kind === NotificationChangeType.REMOVE && this.newNotificationsCount > 0) {
				this.newNotificationsCount--;
			}
		}

		this.updateNotificationsCenterStatusItem();
	}

	private updateNotificationsCenterStatusItem(): void {

		let notificationsInProgress = 0;
		if (!this.isNotificationsCenterVisible && !this.isNotificationsToastsVisible) {
			for (const notification of this.model.notifications) {
				if (notification.hasProgress) {
					notificationsInProgress++;
				}
			}
		}


		let statusProperties: IStatusbarEntry = {
			name: localize('status.notifications', "Notifications"),
			text: `${notificationsInProgress > 0 || this.newNotificationsCount > 0 ? '$(bell-dot)' : '$(bell)'}`,
			ariaLabel: localize('status.notifications', "Notifications"),
			command: this.isNotificationsCenterVisible ? HIDE_NOTIFICATIONS_CENTER : SHOW_NOTIFICATIONS_CENTER,
			tooltip: this.getTooltip(notificationsInProgress),
			showBeak: this.isNotificationsCenterVisible
		};

		if (this.notificationService.getFilter() === NotificationsFilter.ERROR) {
			statusProperties = {
				...statusProperties,
				text: `${notificationsInProgress > 0 || this.newNotificationsCount > 0 ? '$(bell-slash-dot)' : '$(bell-slash)'}`,
				ariaLabel: localize('status.doNotDisturb', "Do Not Disturb"),
				tooltip: localize('status.doNotDisturbTooltip', "Do Not Disturb Mode is Enabled")
			};
		}

		const position = getNotificationsPosition(this.configurationService);
		if (position === NotificationsPosition.TOP_RIGHT) {
			this.notificationsCenterStatusItem?.dispose();
			this.notificationsCenterStatusItem = undefined;

			this.currentAlignment = undefined;
		}

		else {
			const desiredAlignment = this.getDesiredAlignment();

			if (this.currentAlignment !== desiredAlignment) {
				this.notificationsCenterStatusItem?.dispose();
				this.notificationsCenterStatusItem = undefined;

				this.currentAlignment = desiredAlignment;
			}

			if (!this.notificationsCenterStatusItem) {
				this.notificationsCenterStatusItem = this.statusbarService.addEntry(
					statusProperties,
					'status.notifications.right',
					this.currentAlignment,
					this.currentAlignment === StatusbarAlignment.LEFT
						? Number.MAX_SAFE_INTEGER
						: Number.NEGATIVE_INFINITY
				);
			} else {
				this.notificationsCenterStatusItem.update(statusProperties);
			}
		}
	}

	private getDesiredAlignment(): StatusbarAlignment {
		return StatusbarAlignment.RIGHT;
	}

	private getTooltip(notificationsInProgress: number): string {
		if (this.isNotificationsCenterVisible) {
			return localize('hideNotifications', "Hide Notifications");
		}

		if (this.model.notifications.length === 0) {
			return localize('zeroNotifications', "No Notifications");
		}

		if (notificationsInProgress === 0) {
			if (this.newNotificationsCount === 0) {
				return localize('noNotifications', "No New Notifications");
			}

			if (this.newNotificationsCount === 1) {
				return localize('oneNotification', "1 New Notification");
			}

			return localize({ key: 'notifications', comment: ['{0} will be replaced by a number'] }, "{0} New Notifications", this.newNotificationsCount);
		}

		if (this.newNotificationsCount === 0) {
			return localize({ key: 'noNotificationsWithProgress', comment: ['{0} will be replaced by a number'] }, "No New Notifications ({0} in progress)", notificationsInProgress);
		}

		if (this.newNotificationsCount === 1) {
			return localize({ key: 'oneNotificationWithProgress', comment: ['{0} will be replaced by a number'] }, "1 New Notification ({0} in progress)", notificationsInProgress);
		}

		return localize({ key: 'notificationsWithProgress', comment: ['{0} and {1} will be replaced by a number'] }, "{0} New Notifications ({1} in progress)", this.newNotificationsCount, notificationsInProgress);
	}

	update(isCenterVisible: boolean, isToastsVisible: boolean): void {
		let updateNotificationsCenterStatusItem = false;

		if (this.isNotificationsCenterVisible !== isCenterVisible) {
			this.isNotificationsCenterVisible = isCenterVisible;
			this.newNotificationsCount = 0;
			updateNotificationsCenterStatusItem = true;
		}

		if (this.isNotificationsToastsVisible !== isToastsVisible) {
			this.isNotificationsToastsVisible = isToastsVisible;
			updateNotificationsCenterStatusItem = true;
		}

		if (updateNotificationsCenterStatusItem) {
			this.updateNotificationsCenterStatusItem();
		}
	}

	private onDidChangeStatusMessage(e: IStatusMessageChangeEvent): void {
		const statusItem = e.item;

		switch (e.kind) {

			case StatusMessageChangeType.ADD:
				this.doSetStatusMessage(statusItem);

				break;

			case StatusMessageChangeType.REMOVE:
				if (this.currentStatusMessage && this.currentStatusMessage[0] === statusItem) {
					dispose(this.currentStatusMessage[1]);
					this.currentStatusMessage = undefined;
				}

				break;
		}
	}

	private doSetStatusMessage(item: IStatusMessageViewItem): void {
		const message = item.message;

		const showAfter = item.options && typeof item.options.showAfter === 'number' ? item.options.showAfter : 0;
		const hideAfter = item.options && typeof item.options.hideAfter === 'number' ? item.options.hideAfter : -1;

		if (this.currentStatusMessage) {
			dispose(this.currentStatusMessage[1]);
		}

		let statusMessageEntry: IStatusbarEntryAccessor;
		let showHandle: Timeout | undefined = setTimeout(() => {
			statusMessageEntry = this.statusbarService.addEntry(
				{
					name: localize('status.message', "Status Message"),
					text: message,
					ariaLabel: message
				},
				'status.message',
				StatusbarAlignment.LEFT,
				Number.NEGATIVE_INFINITY
			);
			showHandle = undefined;
		}, showAfter);

		let hideHandle: Timeout | undefined;
		const statusMessageDispose = {
			dispose: () => {
				if (showHandle) {
					clearTimeout(showHandle);
				}

				if (hideHandle) {
					clearTimeout(hideHandle);
				}

				statusMessageEntry?.dispose();
			}
		};

		if (hideAfter > 0) {
			hideHandle = setTimeout(() => statusMessageDispose.dispose(), hideAfter);
		}

		this.currentStatusMessage = [item, statusMessageDispose];
	}
}
