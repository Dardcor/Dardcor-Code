/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { status } from '../../../../../../base/browser/ui/aria/aria.js';
import { renderAsPlaintext } from '../../../../../../base/browser/markdownRenderer.js';
import { IStringDictionary } from '../../../../../../base/common/collections.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IMarkdownString } from '../../../../../../base/common/htmlContent.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { URI } from '../../../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../common/languageModels.js';

export const enum ChatInputNotificationSeverity {
	Info = 0,
	Warning = 1,
	Error = 2,
}

export const enum ChatInputNotificationActionKind {
	Command = 'command',
	OpenModelPicker = 'openModelPicker',
	SwitchToModel = 'switchToModel',
}

interface IChatInputNotificationActionBase {
	readonly label: string;
	readonly keepOpen?: boolean;
	readonly telemetryActionId?: string;
}

export interface IChatInputNotificationCommandAction extends IChatInputNotificationActionBase {
	readonly kind: ChatInputNotificationActionKind.Command;
	readonly commandId: string;
	readonly commandArgs?: unknown[];
}

export interface IChatInputNotificationOpenModelPickerAction extends IChatInputNotificationActionBase {
	readonly kind: ChatInputNotificationActionKind.OpenModelPicker;
}

export interface IChatInputNotificationSwitchToModelAction extends IChatInputNotificationActionBase {
	readonly kind: ChatInputNotificationActionKind.SwitchToModel;
	readonly matchesModel: (model: ILanguageModelChatMetadataAndIdentifier) => boolean;
	readonly config?: IStringDictionary<unknown>;
	readonly requireUniqueModel?: boolean;
}

export type IChatInputNotificationAction =
	| IChatInputNotificationCommandAction
	| IChatInputNotificationOpenModelPickerAction
	| IChatInputNotificationSwitchToModelAction;

export interface IChatInputNotificationMuteAction {
	readonly commandId: string;
	readonly commandArgs?: unknown[];
	readonly tooltip: string;
}

export interface IChatInputNotificationModelState {
	readonly currentModel: ILanguageModelChatMetadataAndIdentifier | undefined;
	readonly models: readonly ILanguageModelChatMetadataAndIdentifier[];
}

export interface IChatInputNotificationContext {
	readonly sessionType: string | undefined;
	readonly sessionResource: URI | undefined;
	readonly deferredNotificationsEnabled: boolean;
	readonly isTransientChat: boolean;
	readonly sessionStarted: boolean;
	readonly modelState: IChatInputNotificationModelState;
}

export interface IChatInputNotificationBody {
	readonly description: string | IMarkdownString | undefined;
	readonly actions: readonly IChatInputNotificationAction[];
}

export interface IChatInputNotification {
	readonly id: string;
	readonly telemetryId?: string;
	readonly severity: ChatInputNotificationSeverity;
	readonly message: string | IMarkdownString;
	readonly description: string | IMarkdownString | undefined;
	readonly actions: readonly IChatInputNotificationAction[];
	readonly when?: (context: IChatInputNotificationContext) => boolean;
	readonly resolveBody?: (context: IChatInputNotificationContext) => IChatInputNotificationBody;
	readonly dismissible: boolean;
	readonly autoDismissOnMessage: boolean;
	readonly sessionTypes?: readonly string[];
	readonly sessionResources?: readonly URI[];
	readonly mute?: IChatInputNotificationMuteAction;
}

export function matchesModelIdentifier(identifier: string): (model: ILanguageModelChatMetadataAndIdentifier) => boolean {
	return model => model.identifier === identifier;
}

function evaluateChatInputNotificationPredicate(predicate: () => boolean, onError: (error: unknown) => void): boolean {
	try {
		return predicate();
	} catch (error) {
		onError(error);
		return false;
	}
}

export function resolveChatInputNotificationBody(
	notification: IChatInputNotification,
	context: IChatInputNotificationContext,
	onError: (error: unknown) => void,
): IChatInputNotificationBody | undefined {
	if (!evaluateChatInputNotificationPredicate(() => notification.when?.(context) ?? true, onError)) {
		return undefined;
	}

	if (!notification.resolveBody) {
		return notification;
	}

	try {
		return notification.resolveBody(context);
	} catch (error) {
		onError(error);
		return notification;
	}
}

export function getChatInputNotificationAnnouncementSignature(notification: IChatInputNotification, body: IChatInputNotificationBody): string {
	const message = typeof notification.message === 'string' ? notification.message : notification.message.value;
	const description = typeof body.description === 'string' ? body.description : body.description?.value ?? '';
	return `${notification.id}\u0000${message}\u0000${description}`;
}

export function isChatInputNotificationApplicableToSessionType(notification: IChatInputNotification, sessionType: string | undefined): boolean {
	return !notification.sessionTypes?.length || (!!sessionType && notification.sessionTypes.includes(sessionType));
}

export function isChatInputNotificationApplicableToSession(notification: IChatInputNotification, sessionType: string | undefined, sessionResource: URI | undefined): boolean {
	return isChatInputNotificationApplicableToSessionType(notification, sessionType)
		&& (!notification.sessionResources?.length || (!!sessionResource && notification.sessionResources.some(resource => isEqual(resource, sessionResource))));
}

export const IChatInputNotificationService = createDecorator<IChatInputNotificationService>('chatInputNotificationService');

export interface IChatInputNotificationService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	readonly onDidDismiss: Event<string>;

	setNotification(notification: IChatInputNotification): void;

	deleteNotification(id: string): void;

	refresh(): void;

	dismissNotification(id: string): void;

	getActiveNotification(filter?: (notification: IChatInputNotification) => boolean): IChatInputNotification | undefined;

	handleMessageSent(context?: IChatInputNotificationContext): void;

	announceRendered(notification: IChatInputNotification | undefined, body?: IChatInputNotificationBody): void;
}

class ChatInputNotificationService extends Disposable implements IChatInputNotificationService {
	readonly _serviceBrand: undefined;

	private readonly _notifications = new Map<string, IChatInputNotification>();
	private readonly _dismissed = new Set<string>();

	private readonly _insertionOrder = new Map<string, number>();
	private _insertionCounter = 0;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidDismiss = this._register(new Emitter<string>());
	readonly onDidDismiss = this._onDidDismiss.event;

	private readonly _announcedById = new Map<string, string>();

	constructor(@ILogService private readonly _logService: ILogService) {
		super();
	}

	setNotification(notification: IChatInputNotification): void {
		this._notifications.set(notification.id, notification);
		this._dismissed.delete(notification.id);
		this._insertionOrder.set(notification.id, this._insertionCounter++);
		this._fireDidChange();
	}

	refresh(): void {
		this._fireDidChange();
	}

	deleteNotification(id: string): void {
		if (this._notifications.delete(id)) {
			this._dismissed.delete(id);
			this._insertionOrder.delete(id);
			this._announcedById.delete(id);
			this._fireDidChange();
		}
	}

	dismissNotification(id: string): void {
		if (this._notifications.has(id) && !this._dismissed.has(id)) {
			this._dismissed.add(id);
			this._announcedById.delete(id);
			this._onDidDismiss.fire(id);
			this._fireDidChange();
		}
	}

	getActiveNotification(filter?: (notification: IChatInputNotification) => boolean): IChatInputNotification | undefined {
		let best: IChatInputNotification | undefined;
		let bestOrder = -1;

		for (const notification of this._notifications.values()) {
			if (this._dismissed.has(notification.id)) {
				continue;
			}
			if (filter && !filter(notification)) {
				continue;
			}

			const order = this._insertionOrder.get(notification.id) ?? 0;

			if (!best
				|| notification.severity > best.severity
				|| (notification.severity === best.severity && order > bestOrder)
			) {
				best = notification;
				bestOrder = order;
			}
		}

		return best;
	}

	handleMessageSent(context?: IChatInputNotificationContext): void {
		let changed = false;
		for (const notification of this._notifications.values()) {
			if (!notification.autoDismissOnMessage || this._dismissed.has(notification.id)) {
				continue;
			}
			if (context && !isChatInputNotificationApplicableToSession(notification, context.sessionType, context.sessionResource)) {
				continue;
			}
			if (context && !evaluateChatInputNotificationPredicate(
				() => notification.when?.(context) ?? true,
				error => this._logService.error('[ChatInputNotificationService] Failed to evaluate notification', error),
			)) {
				continue;
			}
			this._dismissed.add(notification.id);
			this._announcedById.delete(notification.id);
			changed = true;
		}
		if (changed) {
			this._fireDidChange();
		}
	}

	private _fireDidChange(): void {
		this._onDidChange.fire();
	}

	announceRendered(notification: IChatInputNotification | undefined, body?: IChatInputNotificationBody): void {
		if (!notification) {
			return;
		}
		const resolvedBody = body ?? notification;
		const signature = getChatInputNotificationAnnouncementSignature(notification, resolvedBody);
		if (this._announcedById.get(notification.id) === signature) {
			return;
		}
		this._announcedById.set(notification.id, signature);
		const message = renderAsPlaintext(notification.message);
		const description = resolvedBody.description ? renderAsPlaintext(resolvedBody.description) : '';
		const text = description ? `${message}. ${description}` : message;
		status(text);
	}
}

registerSingleton(IChatInputNotificationService, ChatInputNotificationService, InstantiationType.Delayed);

export function readDismissedNotificationIds(storageService: IStorageService, key: string): Set<string> {
	const raw = storageService.get(key, StorageScope.APPLICATION);
	try {
		const parsed = raw ? JSON.parse(raw) : undefined;
		return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
	} catch {
		return new Set();
	}
}

export function addDismissedNotificationId(storageService: IStorageService, key: string, id: string): void {
	const dismissed = readDismissedNotificationIds(storageService, key);
	if (dismissed.has(id)) {
		return;
	}
	dismissed.add(id);
	storageService.store(key, JSON.stringify([...dismissed]), StorageScope.APPLICATION, StorageTarget.USER);
}
