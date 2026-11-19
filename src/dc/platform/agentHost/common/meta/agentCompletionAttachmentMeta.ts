/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SimpleMessageAttachment } from '../state/protocol/state.js';


export interface IAgentHostCompletionAction {
	readonly applyConfig?: Readonly<Record<string, string>>;
}

export interface ICommandCompletionAttachmentMeta {
	readonly command: string;
	readonly isSkill?: true;
	readonly description?: string;
	readonly argumentHint?: string;
	readonly action?: IAgentHostCompletionAction;
}

export interface ISkillCompletionAttachmentMeta {
	readonly uri: string;
	readonly name?: string;
	readonly displayName?: string;
	readonly description?: string;
}

export type CompletionAttachmentMeta =
	| ({ readonly kind: 'command' } & ICommandCompletionAttachmentMeta)
	| ({ readonly kind: 'skill' } & ISkillCompletionAttachmentMeta);

export function readCompletionAttachmentMeta(attachment: SimpleMessageAttachment): CompletionAttachmentMeta | undefined {
	const meta = attachment._meta;
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		return undefined;
	}
	if (typeof meta['command'] === 'string') {
		const action = readCompletionActionMeta(meta['action']);
		return {
			kind: 'command',
			command: meta['command'],
			...(meta['isSkill'] === true ? { isSkill: true } : {}),
			...(typeof meta['description'] === 'string' ? { description: meta['description'] } : {}),
			...(typeof meta['argumentHint'] === 'string' ? { argumentHint: meta['argumentHint'] } : {}),
			...(action ? { action } : {}),
		};
	}
	if (typeof meta['uri'] === 'string') {
		return {
			kind: 'skill',
			uri: meta['uri'],
			...(typeof meta['name'] === 'string' ? { name: meta['name'] } : {}),
			...(typeof meta['displayName'] === 'string' ? { displayName: meta['displayName'] } : {}),
			...(typeof meta['description'] === 'string' ? { description: meta['description'] } : {}),
		};
	}
	return undefined;
}

export function toCommandCompletionAttachmentMeta(meta: ICommandCompletionAttachmentMeta): Record<string, unknown> {
	const result: Record<string, unknown> = { command: meta.command };
	if (meta.isSkill === true) {
		result['isSkill'] = true;
	}
	if (meta.description !== undefined) {
		result['description'] = meta.description;
	}
	if (meta.argumentHint !== undefined) {
		result['argumentHint'] = meta.argumentHint;
	}
	const action = toCompletionActionMeta(meta.action);
	if (action !== undefined) {
		result['action'] = action;
	}
	return result;
}

export function getCompletionAction(meta: Record<string, unknown> | undefined): IAgentHostCompletionAction | undefined {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		return undefined;
	}
	return readCompletionActionMeta(meta['action']);
}

function readCompletionActionMeta(value: unknown): IAgentHostCompletionAction | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const raw = value as Record<string, unknown>;
	let applyConfig: Record<string, string> | undefined;
	const rawApplyConfig = raw['applyConfig'];
	if (rawApplyConfig && typeof rawApplyConfig === 'object' && !Array.isArray(rawApplyConfig)) {
		for (const [key, entry] of Object.entries(rawApplyConfig as Record<string, unknown>)) {
			if (typeof entry === 'string') {
				applyConfig ??= {};
				applyConfig[key] = entry;
			}
		}
	}
	if (applyConfig === undefined) {
		return undefined;
	}
	return { applyConfig };
}

function toCompletionActionMeta(action: IAgentHostCompletionAction | undefined): Record<string, unknown> | undefined {
	if (!action?.applyConfig || Object.keys(action.applyConfig).length === 0) {
		return undefined;
	}
	return { applyConfig: { ...action.applyConfig } };
}

export function getCommandArgumentHint(meta: Record<string, unknown> | undefined): string | undefined {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		return undefined;
	}
	return typeof meta['argumentHint'] === 'string' ? meta['argumentHint'] : undefined;
}

export function toSkillCompletionAttachmentMeta(meta: ISkillCompletionAttachmentMeta): Record<string, unknown> {
	const result: Record<string, unknown> = { uri: meta.uri };
	if (meta.name !== undefined) {
		result['name'] = meta.name;
	}
	if (meta.displayName !== undefined) {
		result['displayName'] = meta.displayName;
	}
	if (meta.description !== undefined) {
		result['description'] = meta.description;
	}
	return result;
}
