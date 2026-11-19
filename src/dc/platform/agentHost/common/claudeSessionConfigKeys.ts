/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum ClaudeSessionConfigKey {
	PermissionMode = 'permissionMode',
}

export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto';

export function narrowClaudePermissionMode(raw: unknown): ClaudePermissionMode | undefined {
	switch (raw) {
		case 'default':
		case 'acceptEdits':
		case 'bypassPermissions':
		case 'plan':
		case 'auto':
			return raw;
		default:
			return undefined;
	}
}
