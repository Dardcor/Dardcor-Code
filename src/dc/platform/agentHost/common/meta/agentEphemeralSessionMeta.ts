/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const VSCODE_EPHEMERAL_SESSION_META_KEY = 'vscode.chat.ephemeralSession';

interface IHasEphemeralSessionMeta {
	readonly _meta?: Record<string, unknown>;
}

export interface IEphemeralSessionMeta {
	readonly isEphemeral?: boolean;
}

export function readEphemeralSessionMeta(source: IHasEphemeralSessionMeta): IEphemeralSessionMeta {
	const value = source._meta?.[VSCODE_EPHEMERAL_SESSION_META_KEY];
	return typeof value === 'boolean' ? { isEphemeral: value } : {};
}

export function withEphemeralSessionMeta(meta: Record<string, unknown> | undefined, isEphemeral: boolean | undefined): Record<string, unknown> | undefined {
	if (isEphemeral === undefined) {
		return meta;
	}
	return { ...(meta ?? {}), [VSCODE_EPHEMERAL_SESSION_META_KEY]: isEphemeral };
}
