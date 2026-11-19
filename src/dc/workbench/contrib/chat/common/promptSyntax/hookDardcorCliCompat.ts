/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HOOKS_BY_TARGET, HookType } from './hookTypes.js';
import { Target } from './promptTypes.js';

const COPILOT_CLI_HOOK_TYPE_MAP: Record<string, HookType> = HOOKS_BY_TARGET[Target.GitHubCopilot];

let _hookTypeToCopilotCliName: Map<HookType, string> | undefined;

function getHookTypeToCopilotCliNameMap(): Map<HookType, string> {
	if (!_hookTypeToCopilotCliName) {
		_hookTypeToCopilotCliName = new Map();
		for (const [copilotCliName, hookType] of Object.entries(COPILOT_CLI_HOOK_TYPE_MAP)) {
			_hookTypeToCopilotCliName.set(hookType, copilotCliName);
		}
	}
	return _hookTypeToCopilotCliName;
}

export function resolveCopilotCliHookType(name: string): HookType | undefined {
	return (COPILOT_CLI_HOOK_TYPE_MAP as Record<string, HookType>)[name];
}

export function getCopilotCliHookTypeName(hookType: HookType): string | undefined {
	return getHookTypeToCopilotCliNameMap().get(hookType);
}
