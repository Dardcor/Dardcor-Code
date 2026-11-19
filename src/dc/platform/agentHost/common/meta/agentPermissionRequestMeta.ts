/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


interface IHasPermissionRequestMeta {
	readonly _meta?: Record<string, unknown>;
}

export const enum AgentPermissionRequestKind {
	Commands = 'commands',
	Read = 'read',
}

export interface IAgentPermissionRequestMeta {
	readonly kind?: AgentPermissionRequestKind;
}

function normalizeKind(value: unknown): AgentPermissionRequestKind | undefined {
	switch (value) {
		case 'commands':
		case 'shell':
			return AgentPermissionRequestKind.Commands;
		case 'read':
			return AgentPermissionRequestKind.Read;
		default:
			return undefined;
	}
}

function readKind(value: unknown): AgentPermissionRequestKind | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return normalizeKind((value as Record<string, unknown>)['kind']);
}

export function readAgentPermissionRequestMeta(source: IHasPermissionRequestMeta): IAgentPermissionRequestMeta {
	const meta = source._meta;
	if (!meta) {
		return {};
	}
	const kind = readKind(meta['promptRequest']) ?? readKind(meta['permissionRequest']);
	return kind ? { kind } : {};
}
