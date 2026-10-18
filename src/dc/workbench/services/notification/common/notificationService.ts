/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { INotificationService, INotification, INotificationHandle, Severity, NotificationMessage, INotificationActions, IPromptChoice, IPromptOptions, IStatusMessageOptions, NoOpNotification, NeverShowAgainScope, NotificationsFilter, INeverShowAgainOptions, INotificationSource, INotificationSourceFilter, isNotificationSource, IStatusHandle } from '../../../../platform/notification/common/notification.js';
import { NotificationsModel, ChoiceAction, NotificationChangeType } from '../../../common/notifications.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAction, Action } from '../../../../base/common/actions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export class NotificationService extends Disposable implements INotificationService {

	declare readonly _serviceBrand: undefined;

	readonly model = this._register(new NotificationsModel());

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.mapSourceToFilter = (() => {
			const map = new Map<string, INotificationSourceFilter>();

			for (const sourceFilter of this.storageService.getObject<INotificationSourceFilter[]>(NotificationService.PER_SOURCE_FILTER_SETTINGS_KEY, StorageScope.APPLICATION, [])) {
				map.set(sourceFilter.id, sourceFilter);
			}

			return map;
		})();

		this.globalFilterEnabled = this.storageService.getBoolean(NotificationService.GLOBAL_FILTER_SETTINGS_KEY, StorageScope.APPLICATION, false);

		this.updateFilters();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.model.onDidChangeNotification(e => {
			switch (e.kind) {
				case NotificationChangeType.ADD: {
					const source = typeof e.item.sourceId === 'string' && typeof e.item.source === 'string' ? { id: e.item.sourceId, label: e.item.source } : e.item.source;


					if (isNotificationSource(source)) {
						if (!this.mapSourceToFilter.has(source.id)) {
							this.setFilter({ ...source, filter: NotificationsFilter.OFF });
						} else {
							this.updateSourceFilter(source);
						}
					}

					break;
				}
			}
		}));
	}


	private static readonly GLOBAL_FILTER_SETTINGS_KEY = 'notifications.doNotDisturbMode';
	private static readonly PER_SOURCE_FILTER_SETTINGS_KEY = 'notifications.perSourceDoNotDisturbMode';

	private readonly _onDidChangeFilter = this._register(new Emitter<void>());
	readonly onDidChangeFilter = this._onDidChangeFilter.event;

	private globalFilterEnabled: boolean;

	private readonly mapSourceToFilter: Map<string , INotificationSourceFilter>;

	setFilter(filter: NotificationsFilter | INotificationSourceFilter): void {
		if (typeof filter === 'number') {
			if (this.globalFilterEnabled === (filter === NotificationsFilter.ERROR)) {
				return;
			}

			this.globalFilterEnabled = filter === NotificationsFilter.ERROR;
			this.storageService.store(NotificationService.GLOBAL_FILTER_SETTINGS_KEY, this.globalFilterEnabled, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this.updateFilters();

			this._onDidChangeFilter.fire();
		} else {
			const existing = this.mapSourceToFilter.get(filter.id);
			if (existing?.filter === filter.filter && existing.label === filter.label) {
				return;
			}

			this.mapSourceToFilter.set(filter.id, { id: filter.id, label: filter.label, filter: filter.filter });
			this.saveSourceFilters();

			this.updateFilters();
		}
	}

	getFilter(source?: INotificationSource): NotificationsFilter {
		if (source) {
			return this.mapSourceToFilter.get(source.id)?.filter ?? NotificationsFilter.OFF;
		}

		return this.globalFilterEnabled ? NotificationsFilter.ERROR : NotificationsFilter.OFF;
	}

	private updateSourceFilter(source: INotificationSource): void {
		const existing = this.mapSourceToFilter.get(source.id);
		if (!existing) {
			return;
		}

		if (existing.label !== source.label) {
			this.mapSourceToFilter.set(source.id, { id: source.id, label: source.label, filter: existing.filter });
			this.saveSourceFilters();
		}
	}

	private saveSourceFilters(): void {
		this.storageService.store(NotificationService.PER_SOURCE_FILTER_SETTINGS_KEY, JSON.stringify([...this.mapSourceToFilter.values()]), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	getFilters(): INotificationSourceFilter[] {
		return [...this.mapSourceToFilter.values()];
	}

	private updateFilters(): void {
		this.model.setFilter({
			global: this.globalFilterEnabled ? NotificationsFilter.ERROR : NotificationsFilter.OFF,
			sources: new Map([...this.mapSourceToFilter.values()].map(source => [source.id, source.filter]))
		});
	}

	removeFilter(sourceId: string): void {
		if (this.mapSourceToFilter.delete(sourceId)) {

			this.saveSourceFilters();

			this.updateFilters();
		}
	}


	info(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			for (const messageEntry of message) {
				this.info(messageEntry);
			}

			return;
		}

		this.model.addNotification({ severity: Severity.Info, message });
	}

	warn(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			for (const messageEntry of message) {
				this.warn(messageEntry);
			}

			return;
		}

		this.model.addNotification({ severity: Severity.Warning, message });
	}

	error(message: NotificationMessage | NotificationMessage[]): void {
		if (Array.isArray(message)) {
			for (const messageEntry of message) {
				this.error(messageEntry);
			}

			return;
		}

		this.model.addNotification({ severity: Severity.Error, message });
	}

	notify(notification: INotification): INotificationHandle {
		const toDispose = new DisposableStore();


		if (notification.neverShowAgain) {
			const scope = this.toStorageScope(notification.neverShowAgain);
			const id = notification.neverShowAgain.id;

			if (this.storageService.getBoolean(id, scope)) {
				return new NoOpNotification();
			}

			const neverShowAgainAction = toDispose.add(new Action(
				'workbench.notification.neverShowAgain',
				localize('neverShowAgain', "Don't Show Again"),
				undefined, true, async () => {

					handle.close();

					this.storageService.store(id, true, scope, StorageTarget.USER);
				}));

			const actions = {
				primary: notification.actions?.primary || [],
				secondary: notification.actions?.secondary || []
			};
			if (!notification.neverShowAgain.isSecondary) {
				actions.primary = [neverShowAgainAction, ...actions.primary];
			} else {
				actions.secondary = [...actions.secondary, neverShowAgainAction];
			}

			notification.actions = actions;
		}

		const handle = this.model.addNotification(notification);

		Event.once(handle.onDidClose)(() => toDispose.dispose());

		return handle;
	}

	private toStorageScope(options: INeverShowAgainOptions): StorageScope {
		switch (options.scope) {
			case NeverShowAgainScope.APPLICATION:
				return StorageScope.APPLICATION;
			case NeverShowAgainScope.PROFILE:
				return StorageScope.PROFILE;
			case NeverShowAgainScope.WORKSPACE:
				return StorageScope.WORKSPACE;
			default:
				return StorageScope.APPLICATION;
		}
	}

	prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {

		if (options?.neverShowAgain) {
			const scope = this.toStorageScope(options.neverShowAgain);
			const id = options.neverShowAgain.id;

			if (this.storageService.getBoolean(id, scope)) {
				return new NoOpNotification();
			}

			const neverShowAgainChoice = {
				label: localize('neverShowAgain', "Don't Show Again"),
				run: () => this.storageService.store(id, true, scope, StorageTarget.USER),
				isSecondary: options.neverShowAgain.isSecondary
			};

			if (!options.neverShowAgain.isSecondary) {
				choices = [neverShowAgainChoice, ...choices];
			} else {
				choices = [...choices, neverShowAgainChoice];
			}
		}

		let choiceClicked = false;
		const toDispose = new DisposableStore();


		const primaryActions: IAction[] = [];
		const secondaryActions: IAction[] = [];
		choices.forEach((choice, index) => {
			const action = new ChoiceAction(`workbench.dialog.choice.${index}`, choice);
			if (!choice.isSecondary) {
				primaryActions.push(action);
			} else {
				secondaryActions.push(action);
			}

			toDispose.add(action.onDidRun(() => {
				choiceClicked = true;

				if (!choice.keepOpen) {
					handle.close();
				}
			}));

			toDispose.add(action);
		});

		const actions: INotificationActions = { primary: primaryActions, secondary: secondaryActions };
		const handle = this.notify({ severity, message, actions, sticky: options?.sticky, priority: options?.priority });

		Event.once(handle.onDidClose)(() => {

			toDispose.dispose();

			if (options && typeof options.onCancel === 'function' && !choiceClicked) {
				options.onCancel();
			}
		});

		return handle;
	}

	status(message: NotificationMessage, options?: IStatusMessageOptions): IStatusHandle {
		return this.model.showStatusMessage(message, options);
	}
}

registerSingleton(INotificationService, NotificationService, InstantiationType.Delayed);
