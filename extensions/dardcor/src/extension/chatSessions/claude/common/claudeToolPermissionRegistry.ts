/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IClaudeToolPermissionHandlerCtor } from './claudeToolPermission';
import { ClaudeToolNames } from './claudeTools';

export interface IToolPermissionHandlerRegistration {
	readonly toolNames: readonly ClaudeToolNames[];
	readonly ctor: IClaudeToolPermissionHandlerCtor;
}

const handlerRegistry: IToolPermissionHandlerRegistration[] = [];

export function registerToolPermissionHandler<T extends ClaudeToolNames>(
	toolNames: readonly T[],
	ctor: IClaudeToolPermissionHandlerCtor<T>
): void {
	handlerRegistry.push({ toolNames, ctor });
}

export function getToolPermissionHandlerRegistry(): readonly IToolPermissionHandlerRegistration[] {
	return handlerRegistry;
}
