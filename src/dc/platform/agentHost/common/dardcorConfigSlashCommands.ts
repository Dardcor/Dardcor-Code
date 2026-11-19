/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesFuzzy2 } from '../../../base/common/filters.js';
import { localize } from '../../../nls.js';
import { SessionConfigKey } from './sessionConfigKeys.js';


const AUTO_APPROVE_BYPASS = 'autoApprove';
const AUTO_APPROVE_DEFAULT = 'default';
const MODE_INTERACTIVE = 'interactive';
const MODE_PLAN = 'plan';
const MODE_AUTOPILOT = 'autopilot';

export interface ICopilotConfigSlashCommandItem {
	readonly insertText: string;
	readonly label: string;
	readonly command: string;
	readonly description: string;
	readonly argumentHint?: string;
	readonly applyConfig: Readonly<Record<string, string>>;
	readonly sortText: string;
}

interface IConfigSlashOption {
	readonly arg?: string;
	readonly detail: string;
	readonly config: Readonly<Record<string, string>>;
	readonly argumentHint?: string;
}

interface IConfigSlashCommand {
	readonly command: string;
	readonly sortText: string;
	readonly options: readonly IConfigSlashOption[];
}

function setBypassDetail(): string { return localize('copilotConfigSlash.yolo', "Set permissions to bypass approvals"); }
function setDefaultDetail(): string { return localize('copilotConfigSlash.default', "Set permissions back to default"); }
function autopilotOnDetail(): string { return localize('copilotConfigSlash.autopilot.on', "Switch to autopilot mode"); }
function exitAutopilotDetail(): string { return localize('copilotConfigSlash.exitAutopilot', "Switch to interactive mode"); }
function autopilotPromptDetail(): string { return localize('copilotConfigSlash.autopilot.prompt', "Switch to autopilot mode with an objective"); }
function planPromptDetail(): string { return localize('copilotConfigSlash.plan.prompt', "Create an implementation plan before coding"); }
function autopilotArgumentHint(): string { return localize('copilotConfigSlash.autopilotHint', "objective"); }
function promptArgumentHint(): string { return localize('copilotConfigSlash.promptHint', "Describe what you want to plan or research"); }

function getConfigSlashCommands(): readonly IConfigSlashCommand[] {
	return [
		{
			command: 'yolo', sortText: 'z1_yolo',
			options: [
				{ arg: 'on', detail: setBypassDetail(), config: { [SessionConfigKey.AutoApprove]: AUTO_APPROVE_BYPASS } },
				{ arg: 'off', detail: setDefaultDetail(), config: { [SessionConfigKey.AutoApprove]: AUTO_APPROVE_DEFAULT } }
			],
		},
		{
			command: 'allow-all', sortText: 'z1_allow-all',
			options: [
				{ arg: 'on', detail: setBypassDetail(), config: { [SessionConfigKey.AutoApprove]: AUTO_APPROVE_BYPASS } },
				{ arg: 'off', detail: setDefaultDetail(), config: { [SessionConfigKey.AutoApprove]: AUTO_APPROVE_DEFAULT } }
			],
		},
		{
			command: 'autopilot', sortText: 'z1_autopilot',
			options: [
				{ arg: 'on', detail: autopilotOnDetail(), config: { [SessionConfigKey.Mode]: MODE_AUTOPILOT } },
				{ arg: 'off', detail: exitAutopilotDetail(), config: { [SessionConfigKey.Mode]: MODE_INTERACTIVE } },
				{ detail: autopilotPromptDetail(), config: { [SessionConfigKey.Mode]: MODE_AUTOPILOT }, argumentHint: autopilotArgumentHint() },
			],
		},
		{
			command: 'plan', sortText: 'z1_plan',
			options: [
				{ detail: planPromptDetail(), config: { [SessionConfigKey.Mode]: MODE_PLAN }, argumentHint: promptArgumentHint() },
			],
		},
		{
			command: 'goal', sortText: 'z1_goal',
			options: [
				{ detail: planPromptDetail(), config: { [SessionConfigKey.Mode]: MODE_PLAN }, argumentHint: promptArgumentHint() },
			],
		},
	];
}

export function isCopilotConfigSlashCommand(command: string): boolean {
	return getConfigSlashCommands().some(c => c.command.toLowerCase() === command.toLowerCase());
}

export interface ICopilotConfigSlashCommandState {
	readonly mode?: string;
	readonly autoApprove?: string;
}

function shouldOfferOption(option: IConfigSlashOption, state: ICopilotConfigSlashCommandState | undefined): boolean {
	if (option.argumentHint !== undefined || !state) {
		return true;
	}
	const autoApproveTarget = option.config[SessionConfigKey.AutoApprove];
	if (autoApproveTarget !== undefined) {
		const isBypass = state.autoApprove === AUTO_APPROVE_BYPASS;
		return autoApproveTarget === AUTO_APPROVE_BYPASS ? !isBypass : isBypass;
	}
	const modeTarget = option.config[SessionConfigKey.Mode];
	if (modeTarget === MODE_AUTOPILOT) {
		return state.mode !== MODE_AUTOPILOT;
	}
	if (modeTarget === MODE_INTERACTIVE) {
		return state.mode === MODE_AUTOPILOT;
	}
	return true;
}

export function getCopilotConfigSlashCommandItems(typed: string, state?: ICopilotConfigSlashCommandState): ICopilotConfigSlashCommandItem[] {
	const typedLower = typed.trim().toLowerCase();
	const items: ICopilotConfigSlashCommandItem[] = [];
	for (const command of getConfigSlashCommands()) {
		if (typedLower
			&& !command.command.toLowerCase().startsWith(typedLower)
			&& (typedLower.length === 1 || matchesFuzzy2(typedLower, command.command) === null)
		) {
			continue;
		}
		for (const option of command.options) {
			if (!shouldOfferOption(option, state)) {
				continue;
			}
			const keep = option.argumentHint !== undefined;
			const insertText = keep ? `/${command.command} ` : '';
			const label = keep
				? `/${command.command}`
				: (option.arg ? `/${command.command} ${option.arg}` : `/${command.command}`);
			items.push({
				insertText,
				label,
				command: command.command,
				description: option.detail,
				...(option.argumentHint !== undefined ? { argumentHint: option.argumentHint } : {}),
				applyConfig: option.config,
				sortText: option.arg ? `${command.sortText}_${option.arg}` : command.sortText,
			});
		}
	}
	return items;
}

export interface ICopilotConfigSlashCommandSendResult {
	readonly applyConfig: Readonly<Record<string, string>>;
	readonly strippedPrompt: string;
}

export function resolveCopilotConfigSlashCommandOnSend(command: string, rest: string): ICopilotConfigSlashCommandSendResult | undefined {
	const descriptor = getConfigSlashCommands().find(c => c.command.toLowerCase() === command.toLowerCase());
	if (!descriptor) {
		return undefined;
	}
	const trimmedRest = rest.trim();
	const namedOptions = descriptor.options.filter(o => o.arg !== undefined);
	const baseOption = descriptor.options.find(o => o.arg === undefined);
	if (namedOptions.length > 0 && trimmedRest.length > 0) {
		const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmedRest);
		const firstToken = match?.[1]?.toLowerCase();
		const matched = namedOptions.find(o => o.arg?.toLowerCase() === firstToken);
		if (matched) {
			return { applyConfig: matched.config, strippedPrompt: (match?.[2] ?? '').trim() };
		}
		if (!baseOption) {
			return undefined;
		}
	}
	const fallback = baseOption ?? descriptor.options[0];
	return { applyConfig: fallback.config, strippedPrompt: trimmedRest };
}
