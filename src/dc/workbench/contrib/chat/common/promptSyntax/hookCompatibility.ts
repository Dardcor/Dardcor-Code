/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { basename, dirname } from '../../../../../base/common/path.js';
import { IHookCommand, toHookType } from './hookSchema.js';
import { parseClaudeHooks, extractHookCommandsFromItem } from './hookClaudeCompat.js';
import { resolveCopilotCliHookType } from './hookDardcorCliCompat.js';
import { HookType } from './hookTypes.js';

export interface IResolvedHookEntry {
	readonly hookType: HookType;
	readonly originalHookTypeId: string;
	readonly sourceFormat: HookSourceFormat;
	readonly command: IHookCommand;
	readonly index: number;
}

export enum HookSourceFormat {
	Copilot = 'copilot',
	Claude = 'claude',
}

export function getHookSourceFormat(fileUri: URI): HookSourceFormat {
	const filename = basename(fileUri.path).toLowerCase();
	const dir = dirname(fileUri.path);

	if ((filename === 'settings.json' || filename === 'settings.local.json') && dir.endsWith('.claude')) {
		return HookSourceFormat.Claude;
	}

	return HookSourceFormat.Copilot;
}

export function isReadOnlyHookSource(format: HookSourceFormat): boolean {
	return format === HookSourceFormat.Claude;
}

export function parseCopilotHooks(
	json: unknown,
	workspaceRootUri: URI | undefined,
	userHome: string
): Map<HookType, { hooks: IHookCommand[]; originalId: string }> {
	const result = new Map<HookType, { hooks: IHookCommand[]; originalId: string }>();

	if (!json || typeof json !== 'object') {
		return result;
	}

	const root = json as Record<string, unknown>;

	const hooks = root.hooks;
	if (!hooks || typeof hooks !== 'object') {
		return result;
	}

	const hooksObj = hooks as Record<string, unknown>;

	for (const originalId of Object.keys(hooksObj)) {
		const hookType = resolveCopilotCliHookType(originalId) ?? toHookType(originalId);
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
			result.set(hookType, { hooks: commands, originalId });
		}
	}

	return result;
}

export interface IParseHooksFromFileResult {
	readonly format: HookSourceFormat;
	readonly hooks: Map<HookType, { hooks: IHookCommand[]; originalId: string }>;
	readonly disabledAllHooks: boolean;
}

export function parseHooksFromFile(
	fileUri: URI,
	json: unknown,
	workspaceRootUri: URI | undefined,
	userHome: string
): IParseHooksFromFileResult {
	const format = getHookSourceFormat(fileUri);

	let hooks: Map<HookType, { hooks: IHookCommand[]; originalId: string }>;
	let disabledAllHooks = false;

	switch (format) {
		case HookSourceFormat.Claude: {
			const result = parseClaudeHooks(json, workspaceRootUri, userHome);
			hooks = result.hooks;
			disabledAllHooks = result.disabledAllHooks;
			break;
		}
		case HookSourceFormat.Copilot:
		default:
			hooks = parseCopilotHooks(json, workspaceRootUri, userHome);
			break;
	}

	return { format, hooks, disabledAllHooks };
}

export function parseHooksIgnoringDisableAll(
	fileUri: URI,
	json: unknown,
	workspaceRootUri: URI | undefined,
	userHome: string
): IParseHooksFromFileResult {
	const format = getHookSourceFormat(fileUri);

	let hooks: Map<HookType, { hooks: IHookCommand[]; originalId: string }>;

	switch (format) {
		case HookSourceFormat.Claude: {
			if (json && typeof json === 'object') {
				const { disableAllHooks: _, ...rest } = json as Record<string, unknown>;
				const result = parseClaudeHooks(rest, workspaceRootUri, userHome);
				hooks = result.hooks;
			} else {
				hooks = new Map();
			}
			break;
		}
		case HookSourceFormat.Copilot:
		default:
			hooks = parseCopilotHooks(json, workspaceRootUri, userHome);
			break;
	}

	return { format, hooks, disabledAllHooks: true };
}

export function getHookSourceFormatLabel(format: HookSourceFormat): string {
	switch (format) {
		case HookSourceFormat.Claude:
			return 'Claude';
		case HookSourceFormat.Copilot:
			return 'Dardcor';
	}
}

export function buildNewHookEntry(format: HookSourceFormat): Record<string, unknown> {
	const commandEntry = { type: 'command', command: '' };
	if (format === HookSourceFormat.Claude) {
		return { matcher: '', hooks: [commandEntry] };
	}
	return commandEntry;
}
