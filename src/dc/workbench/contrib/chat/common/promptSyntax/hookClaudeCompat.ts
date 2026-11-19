/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { toHookType, IHookCommand, extractHookCommandsFromItem } from './hookSchema.js';
import { HOOKS_BY_TARGET, HookType } from './hookTypes.js';
import { Target } from './promptTypes.js';

export { extractHookCommandsFromItem };

let _hookTypeToClaudeName: Map<HookType, string> | undefined;

function getHookTypeToClaudeNameMap(): Map<HookType, string> {
	if (!_hookTypeToClaudeName) {
		_hookTypeToClaudeName = new Map();
		for (const [claudeName, hookType] of Object.entries(HOOKS_BY_TARGET[Target.Claude])) {
			_hookTypeToClaudeName.set(hookType, claudeName);
		}
	}
	return _hookTypeToClaudeName;
}

export function resolveClaudeHookType(name: string): HookType | undefined {
	return HOOKS_BY_TARGET[Target.Claude][name];
}

export function getClaudeHookTypeName(hookType: HookType): string | undefined {
	return getHookTypeToClaudeNameMap().get(hookType);
}

export interface IParseClaudeHooksResult {
	readonly hooks: Map<HookType, { hooks: IHookCommand[]; originalId: string }>;
	readonly disabledAllHooks: boolean;
}

export function parseClaudeHooks(
	json: unknown,
	workspaceRootUri: URI | undefined,
	userHome: string
): IParseClaudeHooksResult {
	const result = new Map<HookType, { hooks: IHookCommand[]; originalId: string }>();

	if (!json || typeof json !== 'object') {
		return { hooks: result, disabledAllHooks: false };
	}

	const root = json as Record<string, unknown>;

	if (root.disableAllHooks === true) {
		return { hooks: result, disabledAllHooks: true };
	}

	const hooks = root.hooks;

	if (!hooks || typeof hooks !== 'object') {
		return { hooks: result, disabledAllHooks: false };
	}

	const hooksObj = hooks as Record<string, unknown>;

	for (const originalId of Object.keys(hooksObj)) {
		const hookType = resolveClaudeHookType(originalId) ?? toHookType(originalId);
		if (!hookType) {
			continue;
		}

		const hookArray = hooksObj[originalId];
		if (!Array.isArray(hookArray)) {
			continue;
		}

		const commands: IHookCommand[] = [];

		for (const item of hookArray) {
			const extracted = extractHookCommandsFromItem(item, workspaceRootUri, userHome);
			commands.push(...extracted);
		}

		if (commands.length > 0) {
			const existing = result.get(hookType);
			if (existing) {
				existing.hooks.push(...commands);
			} else {
				result.set(hookType, { hooks: commands, originalId });
			}
		}
	}

	return { hooks: result, disabledAllHooks: false };
}


