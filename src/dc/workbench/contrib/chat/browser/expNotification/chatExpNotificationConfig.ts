/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { stableStringify } from '../../../../../base/common/objects.js';
import { expandModelMatchCandidates, ID_PATTERN, isObject, MAX_ID_LENGTH, modelSelectorAliases, normalizeSelector, parseExpPayloadEnvelope, readSelectorList, readText } from '../../common/expPayload.js';
import { ChatInputNotificationActionKind, ChatInputNotificationSeverity, IChatInputNotification, IChatInputNotificationAction } from '../widget/input/chatInputNotificationService.js';

export const CHAT_EXP_NOTIFICATION_VERSION = 1;

const MAX_NOTIFICATIONS = 8;
const MAX_ACTIONS = 3;
const MAX_CONFIG_KEYS = 8;

const MATCH_KEYS = ['sessionTypes', 'selectedModels', 'excludeSelectedModels'];
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_LABEL_LENGTH = 40;

const SEVERITIES = new Map([
	['info', ChatInputNotificationSeverity.Info],
	['warning', ChatInputNotificationSeverity.Warning],
	['error', ChatInputNotificationSeverity.Error],
]);

export interface IChatExpNotificationMatch {
	readonly sessionTypes: readonly string[];
	readonly selectedModels: readonly string[];
	readonly excludeSelectedModels: readonly string[];
}

export type ChatExpNotification = Omit<IChatInputNotification, 'when'> & {
	readonly match: IChatExpNotificationMatch;
	readonly signature: string;
};

type ChatExpNotificationAction = IChatInputNotificationAction & { telemetryActionId: string };

export type ChatExpNotificationParseResult =
	| { readonly notifications: readonly ChatExpNotification[]; readonly error?: undefined }
	| { readonly notifications?: undefined; readonly error: string };

export interface IChatExpNotificationMatchContext {
	readonly sessionType: string | undefined;
	readonly harness: string | undefined;
	readonly selectedModelId: string | undefined;
	readonly selectedModelAliases: readonly string[] | undefined;
}

export function parseChatExpNotifications(raw: string | undefined): ChatExpNotificationParseResult {
	const parsed = parseExpPayloadEnvelope(raw, CHAT_EXP_NOTIFICATION_VERSION);
	if (typeof parsed === 'string') {
		return { error: parsed };
	}
	if (!Array.isArray(parsed.notifications)) {
		return { error: 'notifications must be an array' };
	}
	if (parsed.notifications.length > MAX_NOTIFICATIONS) {
		return { error: `notifications exceeds ${MAX_NOTIFICATIONS} entries` };
	}

	const notifications: ChatExpNotification[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < parsed.notifications.length; i++) {
		const notification = readNotification(parsed.notifications[i], `notifications[${i}]`);
		if (typeof notification === 'string') {
			return { error: notification };
		}
		if (seen.has(notification.id)) {
			return { error: `notifications[${i}].id "${notification.id}" is duplicated` };
		}
		seen.add(notification.id);
		notifications.push(notification);
	}

	return { notifications };
}

function readNotification(raw: unknown, path: string): ChatExpNotification | string {
	if (!isObject(raw)) {
		return `${path} must be an object`;
	}

	const id = readText(raw.id, MAX_ID_LENGTH, ID_PATTERN);
	if (!id) {
		return `${path}.id is missing or malformed`;
	}

	const message = readText(raw.title, MAX_TITLE_LENGTH);
	if (!message) {
		return `${path}.title is missing or too long`;
	}

	const description = raw.description === undefined ? undefined : readText(raw.description, MAX_DESCRIPTION_LENGTH);
	if (raw.description !== undefined && !description) {
		return `${path}.description is empty or too long`;
	}

	const severity = raw.severity === undefined ? ChatInputNotificationSeverity.Info : SEVERITIES.get(raw.severity as string);
	if (severity === undefined) {
		return `${path}.severity must be "info", "warning" or "error"`;
	}

	const match = readMatch(raw.match, `${path}.match`);
	if (typeof match === 'string') {
		return match;
	}

	const actions = readActions(raw.actions, `${path}.actions`);
	if (typeof actions === 'string') {
		return actions;
	}

	const dismissible = readBoolean(raw.dismissible, true);
	const autoDismissOnMessage = readBoolean(raw.autoDismissOnMessage, false);
	if (dismissible === undefined || autoDismissOnMessage === undefined) {
		return `${path}.dismissible and ${path}.autoDismissOnMessage must be booleans`;
	}

	if (!dismissible && !autoDismissOnMessage && !actions.length) {
		return `${path} must be dismissible, auto-dismiss on message, or offer an action`;
	}

	return {
		id,
		telemetryId: id,
		severity,
		message,
		description,
		match,
		actions,
		dismissible,
		autoDismissOnMessage,
		signature: stableStringify(raw),
	};
}

function readBoolean(raw: unknown, fallback: boolean): boolean | undefined {
	return raw === undefined ? fallback : typeof raw === 'boolean' ? raw : undefined;
}

function readMatch(raw: unknown, path: string): IChatExpNotificationMatch | string {
	if (raw !== undefined && !isObject(raw)) {
		return `${path} must be an object`;
	}
	const source = isObject(raw) ? raw : {};

	const unknown = Object.keys(source).find(key => !MATCH_KEYS.includes(key));
	if (unknown) {
		return `${path} has unknown key ${JSON.stringify(unknown)}`;
	}

	const sessionTypes = readSelectorList(source.sessionTypes, `${path}.sessionTypes`);
	if (typeof sessionTypes === 'string') {
		return sessionTypes;
	}
	const selectedModels = readSelectorList(source.selectedModels, `${path}.selectedModels`);
	if (typeof selectedModels === 'string') {
		return selectedModels;
	}
	const excludeSelectedModels = readSelectorList(source.excludeSelectedModels, `${path}.excludeSelectedModels`);
	if (typeof excludeSelectedModels === 'string') {
		return excludeSelectedModels;
	}
	if (!sessionTypes.length && !selectedModels.length && !excludeSelectedModels.length) {
		return `${path} must narrow at least one dimension`;
	}

	return { sessionTypes, selectedModels, excludeSelectedModels };
}

function readActions(raw: unknown, path: string): ChatExpNotificationAction[] | string {
	if (raw === undefined) {
		return [];
	}
	if (!Array.isArray(raw)) {
		return `${path} must be an array`;
	}
	if (raw.length > MAX_ACTIONS) {
		return `${path} exceeds ${MAX_ACTIONS} entries`;
	}

	const actions: ChatExpNotificationAction[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < raw.length; i++) {
		const action = readAction(raw[i], `${path}[${i}]`);
		if (typeof action === 'string') {
			return action;
		}
		if (seen.has(action.telemetryActionId)) {
			return `${path}[${i}].id "${action.telemetryActionId}" is duplicated`;
		}
		seen.add(action.telemetryActionId);
		actions.push(action);
	}
	return actions;
}

function readAction(raw: unknown, path: string): ChatExpNotificationAction | string {
	if (!isObject(raw)) {
		return `${path} must be an object`;
	}

	const telemetryActionId = readText(raw.id, MAX_ID_LENGTH, ID_PATTERN);
	if (!telemetryActionId) {
		return `${path}.id is missing or malformed`;
	}

	const label = readText(raw.label, MAX_LABEL_LENGTH);
	if (!label) {
		return `${path}.label is missing or too long`;
	}

	const base = { label, telemetryActionId };
	switch (raw.kind) {
		case ChatInputNotificationActionKind.OpenModelPicker:
			return { ...base, kind: ChatInputNotificationActionKind.OpenModelPicker };

		case ChatInputNotificationActionKind.Command: {
			if (typeof raw.commandId !== 'string' || !raw.commandId.trim()) {
				return `${path}.commandId is missing`;
			}
			if (raw.args !== undefined && !Array.isArray(raw.args)) {
				return `${path}.args must be an array`;
			}
			return { ...base, kind: ChatInputNotificationActionKind.Command, commandId: raw.commandId.trim(), commandArgs: raw.args ?? [] };
		}

		case ChatInputNotificationActionKind.SwitchToModel: {
			if (typeof raw.model !== 'string' || !raw.model.trim()) {
				return `${path}.model is missing`;
			}
			if (raw.config !== undefined && (!isObject(raw.config) || Object.keys(raw.config).length > MAX_CONFIG_KEYS)) {
				return `${path}.config must be an object of at most ${MAX_CONFIG_KEYS} keys`;
			}
			const target = normalizeSelector(raw.model);
			return {
				...base,
				kind: ChatInputNotificationActionKind.SwitchToModel,
				matchesModel: model => expandModelMatchCandidates(model.identifier, modelSelectorAliases(model.metadata)).has(target),
				config: raw.config,
				requireUniqueModel: true,
			};
		}
	}

	return `${path}.kind must be "${ChatInputNotificationActionKind.Command}", "${ChatInputNotificationActionKind.OpenModelPicker}" or "${ChatInputNotificationActionKind.SwitchToModel}"`;
}

export function matchesChatExpNotification(match: IChatExpNotificationMatch, context: IChatExpNotificationMatchContext): boolean {
	const { sessionTypes, selectedModels, excludeSelectedModels } = match;
	const sessionCandidates = [context.sessionType, context.harness].map(value => value && normalizeSelector(value));
	const modelCandidates = expandModelMatchCandidates(context.selectedModelId, context.selectedModelAliases);

	return (!sessionTypes.length || sessionTypes.some(selector => sessionCandidates.includes(selector)))
		&& (!selectedModels.length || selectedModels.some(selector => modelCandidates.has(selector)))
		&& !excludeSelectedModels.some(selector => modelCandidates.has(selector));
}
