/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from '../../../../../base/common/jsonSchema.js';
import * as nls from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { isAbsolute } from '../../../../../base/common/path.js';
import { untildify } from '../../../../../base/common/labels.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { IParsedHookCommand } from '../../../../../platform/agentPlugins/common/pluginParsers.js';
import { HookType, HOOKS_BY_TARGET, HOOK_METADATA } from './hookTypes.js';
import { Target } from './promptTypes.js';
import { IValue, IMapValue } from './promptFileParser.js';

export interface IHookCommand extends IParsedHookCommand {
	readonly type: 'command';
	readonly windowsSource?: 'windows' | 'powershell';
	readonly linuxSource?: 'linux' | 'bash';
	readonly osxSource?: 'osx' | 'bash';
}

export type ChatRequestHooks = {
	readonly [K in HookType]?: readonly IParsedHookCommand[];
};

export namespace ChatRequestHooks {
	export function isEquals(a: ChatRequestHooks | undefined, b: ChatRequestHooks | undefined): boolean {
		if (a === b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		for (const hookType of Object.values(HookType)) {
			const aArr = a[hookType];
			const bArr = b[hookType];
			if (aArr?.length !== bArr?.length) {
				return false;
			}
			if (aArr && bArr) {
				for (let i = 0; i < aArr.length; i++) {
					if (!IParsedHookCommand.isEquals(aArr[i], bArr[i])) {
						return false;
					}
				}
			}
		}
		return true;
	}
}

export function mergeHooks(base: ChatRequestHooks | undefined, additional: ChatRequestHooks): ChatRequestHooks {
	if (!base) {
		return additional;
	}

	const result: Partial<Record<HookType, readonly IParsedHookCommand[]>> = { ...base };
	for (const hookType of Object.values(HookType)) {
		const baseArr = base[hookType];
		const additionalArr = additional[hookType];
		if (additionalArr && additionalArr.length > 0) {
			result[hookType] = baseArr ? [...baseArr, ...additionalArr] : additionalArr;
		}
	}
	return result as ChatRequestHooks;
}

export const HOOK_COMMAND_FIELD_DESCRIPTIONS: Record<string, string> = {
	type: nls.localize('hook.type', 'Must be "command".'),
	command: nls.localize('hook.command', 'The command to execute. This is the default cross-platform command.'),
	windows: nls.localize('hook.windows', 'Windows-specific command. If specified and running on Windows, this overrides the "command" field.'),
	linux: nls.localize('hook.linux', 'Linux-specific command. If specified and running on Linux, this overrides the "command" field.'),
	osx: nls.localize('hook.osx', 'macOS-specific command. If specified and running on macOS, this overrides the "command" field.'),
	bash: nls.localize('hook.bash', 'Bash command for Linux and macOS.'),
	powershell: nls.localize('hook.powershell', 'PowerShell command for Windows.'),
	cwd: nls.localize('hook.cwd', 'Working directory for the script (relative to repository root).'),
	env: nls.localize('hook.env', 'Additional environment variables that are merged with the existing environment.'),
	timeout: nls.localize('hook.timeout', 'Maximum execution time in seconds (default: 30).'),
	timeoutSec: nls.localize('hook.timeoutSec', 'Maximum execution time in seconds (default: 10).'),
};

const vscodeHookCommandSchema: IJSONSchema = {
	type: 'object',
	additionalProperties: true,
	required: ['type'],
	anyOf: [
		{ required: ['command'] },
		{ required: ['windows'] },
		{ required: ['linux'] },
		{ required: ['osx'] },
		{ required: ['bash'] },
		{ required: ['powershell'] }
	],
	errorMessage: nls.localize('hook.commandRequired', 'At least one of "command", "windows", "linux", or "osx" must be specified.'),
	properties: {
		type: {
			type: 'string',
			enum: ['command'],
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.type
		},
		command: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.command
		},
		windows: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.windows
		},
		linux: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.linux
		},
		osx: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.osx
		},
		cwd: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.cwd
		},
		env: {
			type: 'object',
			additionalProperties: { type: 'string' },
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.env
		},
		timeout: {
			type: 'number',
			default: 30,
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.timeout
		}
	}
};

const hookArraySchema: IJSONSchema = {
	type: 'array',
	items: vscodeHookCommandSchema
};

function buildHookProperties(target: Target, arraySchema: IJSONSchema): Record<string, IJSONSchema> {
	return Object.fromEntries(
		Object.entries(HOOKS_BY_TARGET[target]).map(([key, hookType]) => [
			key,
			{ ...arraySchema, description: HOOK_METADATA[hookType]?.description }
		])
	);
}

const vscodeHookProperties: Record<string, IJSONSchema> = buildHookProperties(Target.VSCode, hookArraySchema);

const copilotCliHookCommandSchema: IJSONSchema = {
	type: 'object',
	additionalProperties: true,
	required: ['type'],
	anyOf: [
		{ required: ['bash'] },
		{ required: ['powershell'] }
	],
	errorMessage: nls.localize('hook.cliCommandRequired', 'At least one of "bash" or "powershell" must be specified.'),
	properties: {
		type: {
			type: 'string',
			enum: ['command'],
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.type
		},
		bash: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.bash
		},
		powershell: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.powershell
		},
		cwd: {
			type: 'string',
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.cwd
		},
		env: {
			type: 'object',
			additionalProperties: { type: 'string' },
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.env
		},
		timeoutSec: {
			type: 'number',
			default: 10,
			description: HOOK_COMMAND_FIELD_DESCRIPTIONS.timeoutSec
		}
	}
};

const copilotCliHookArraySchema: IJSONSchema = {
	type: 'array',
	items: copilotCliHookCommandSchema
};

const copilotCliHookProperties: Record<string, IJSONSchema> = buildHookProperties(Target.GitHubCopilot, copilotCliHookArraySchema);

export const hookFileSchema: IJSONSchema = {
	$schema: 'http://json-schema.org/draft-07/schema#',
	type: 'object',
	description: nls.localize('hookFile.description', 'Dardcor hook configuration file. Hooks enable executing custom shell commands at strategic points in an agent\'s workflow.'),
	additionalProperties: true,
	required: ['hooks'],
	properties: {
		hooks: {
			type: 'object',
			description: nls.localize('hookFile.hooks', 'Hook definitions organized by type.'),
			additionalProperties: true,
		}
	},
	if: {
		required: ['version'],
		properties: {
			version: { type: 'number' }
		}
	},
	then: {
		properties: {
			version: {
				type: 'number',
				description: nls.localize('hookFile.version', 'Hook configuration format version.'),
			},
			hooks: {
				properties: copilotCliHookProperties
			}
		}
	},
	else: {
		properties: {
			hooks: {
				properties: vscodeHookProperties
			}
		}
	},
	defaultSnippets: [
		{
			label: nls.localize('hookFile.snippet.basic', 'Basic hook configuration'),
			description: nls.localize('hookFile.snippet.basic.description', 'A basic hook configuration with common hooks'),
			body: {
				hooks: {
					SessionStart: [
						{
							type: 'command',
							command: '${1:echo "Session started" >> session.log}',
						}
					],
					PreToolUse: [
						{
							type: 'command',
							command: '${2:./scripts/validate.sh}',
							timeout: 15
						}
					]
				}
			}
		}
	]
};

export const HOOK_SCHEMA_URI = 'vscode://schemas/hooks';

export function toHookType(rawHookTypeId: string): HookType | undefined {
	if (Object.values(HookType).includes(rawHookTypeId as HookType)) {
		return rawHookTypeId as HookType;
	}
	return undefined;
}

function normalizeHookCommand(raw: Record<string, unknown>): { command?: string; windows?: string; linux?: string; osx?: string; windowsSource?: 'windows' | 'powershell'; linuxSource?: 'linux' | 'bash'; osxSource?: 'osx' | 'bash'; cwd?: string; env?: Record<string, string>; timeout?: number } | undefined {
	if (raw.type !== 'command') {
		return undefined;
	}

	const hasCommand = typeof raw.command === 'string' && raw.command.length > 0;
	const hasBash = typeof raw.bash === 'string' && (raw.bash as string).length > 0;
	const hasPowerShell = typeof raw.powershell === 'string' && (raw.powershell as string).length > 0;

	const hasWindows = typeof raw.windows === 'string' && (raw.windows as string).length > 0;
	const hasLinux = typeof raw.linux === 'string' && (raw.linux as string).length > 0;
	const hasOsx = typeof raw.osx === 'string' && (raw.osx as string).length > 0;

	const windows = hasWindows ? raw.windows as string : (hasPowerShell ? raw.powershell as string : undefined);
	const linux = hasLinux ? raw.linux as string : (hasBash ? raw.bash as string : undefined);
	const osx = hasOsx ? raw.osx as string : (hasBash ? raw.bash as string : undefined);

	const windowsSource: 'windows' | 'powershell' | undefined = hasWindows ? 'windows' : (hasPowerShell ? 'powershell' : undefined);
	const linuxSource: 'linux' | 'bash' | undefined = hasLinux ? 'linux' : (hasBash ? 'bash' : undefined);
	const osxSource: 'osx' | 'bash' | undefined = hasOsx ? 'osx' : (hasBash ? 'bash' : undefined);

	return {
		...(hasCommand && { command: raw.command as string }),
		...(windows && { windows }),
		...(linux && { linux }),
		...(osx && { osx }),
		...(windowsSource && { windowsSource }),
		...(linuxSource && { linuxSource }),
		...(osxSource && { osxSource }),
		...(typeof raw.cwd === 'string' && { cwd: raw.cwd }),
		...(typeof raw.env === 'object' && raw.env !== null && { env: raw.env as Record<string, string> }),
		...(typeof raw.timeout !== 'number' && typeof raw.timeoutSec === 'number' && { timeout: raw.timeoutSec }),
		...(typeof raw.timeout === 'number' && { timeout: raw.timeout }),
	};
}

export function getPlatformLabel(os: OperatingSystem): string {
	if (os === OperatingSystem.Windows) {
		return 'Windows';
	} else if (os === OperatingSystem.Macintosh) {
		return 'macOS';
	} else if (os === OperatingSystem.Linux) {
		return 'Linux';
	}
	return '';
}

export function resolveEffectiveCommand(hook: IParsedHookCommand, os: OperatingSystem): string | undefined {
	if (os === OperatingSystem.Windows && hook.windows) {
		return hook.windows;
	} else if (os === OperatingSystem.Macintosh && hook.osx) {
		return hook.osx;
	} else if (os === OperatingSystem.Linux && hook.linux) {
		return hook.linux;
	}

	return hook.command;
}

export function isUsingPlatformOverride(hook: IParsedHookCommand, os: OperatingSystem): boolean {
	if (os === OperatingSystem.Windows && hook.windows) {
		return true;
	} else if (os === OperatingSystem.Macintosh && hook.osx) {
		return true;
	} else if (os === OperatingSystem.Linux && hook.linux) {
		return true;
	}
	return false;
}

export function getEffectiveCommandSource(hook: IHookCommand, os: OperatingSystem): 'powershell' | 'bash' | undefined {
	if (os === OperatingSystem.Windows && hook.windows && hook.windowsSource === 'powershell') {
		return 'powershell';
	} else if (os === OperatingSystem.Macintosh && hook.osx && hook.osxSource === 'bash') {
		return 'bash';
	} else if (os === OperatingSystem.Linux && hook.linux && hook.linuxSource === 'bash') {
		return 'bash';
	}
	return undefined;
}

export function getEffectiveCommandFieldKey(hook: IHookCommand | IParsedHookCommand, os: OperatingSystem): string {
	const h = hook as Partial<IHookCommand>;
	if (os === OperatingSystem.Windows && hook.windows) {
		return h.windowsSource ?? 'windows';
	} else if (os === OperatingSystem.Macintosh && hook.osx) {
		return h.osxSource ?? 'osx';
	} else if (os === OperatingSystem.Linux && hook.linux) {
		return h.linuxSource ?? 'linux';
	}
	return 'command';
}

export function formatHookCommandLabel(hook: IParsedHookCommand, os: OperatingSystem): string {
	const command = resolveEffectiveCommand(hook, os);
	if (!command) {
		return '';
	}
	return command;
}

export function resolveHookCommand(raw: Record<string, unknown>, workspaceRootUri: URI | undefined, userHome: string): IHookCommand | undefined {
	const normalized = normalizeHookCommand(raw);
	if (!normalized) {
		return undefined;
	}

	let cwdUri: URI | undefined;
	if (normalized.cwd) {
		const expandedCwd = untildify(normalized.cwd, userHome);
		if (isAbsolute(expandedCwd)) {
			cwdUri = URI.file(expandedCwd);
		} else if (workspaceRootUri) {
			cwdUri = joinPath(workspaceRootUri, expandedCwd);
		}
	} else {
		cwdUri = workspaceRootUri;
	}

	return {
		type: 'command',
		...(normalized.command && { command: normalized.command }),
		...(normalized.windows && { windows: normalized.windows }),
		...(normalized.linux && { linux: normalized.linux }),
		...(normalized.osx && { osx: normalized.osx }),
		...(normalized.windowsSource && { windowsSource: normalized.windowsSource }),
		...(normalized.linuxSource && { linuxSource: normalized.linuxSource }),
		...(normalized.osxSource && { osxSource: normalized.osxSource }),
		...(cwdUri && { cwd: cwdUri }),
		...(normalized.env && { env: normalized.env }),
		...(normalized.timeout !== undefined && { timeout: normalized.timeout }),
	};
}

export function extractHookCommandsFromItem(
	item: unknown,
	workspaceRootUri: URI | undefined,
	userHome: string
): IHookCommand[] {
	if (!item || typeof item !== 'object') {
		return [];
	}

	const itemObj = item as Record<string, unknown>;
	const commands: IHookCommand[] = [];

	const nestedHooks = itemObj.hooks;
	if (nestedHooks !== undefined && Array.isArray(nestedHooks)) {
		for (const nestedHook of nestedHooks) {
			if (!nestedHook || typeof nestedHook !== 'object') {
				continue;
			}
			const normalized = normalizeForResolve(nestedHook as Record<string, unknown>);
			const resolved = resolveHookCommand(normalized, workspaceRootUri, userHome);
			if (resolved) {
				commands.push(resolved);
			}
		}
	} else {
		const normalized = normalizeForResolve(itemObj);
		const resolved = resolveHookCommand(normalized, workspaceRootUri, userHome);
		if (resolved) {
			commands.push(resolved);
		}
	}

	return commands;
}

function normalizeForResolve(raw: Record<string, unknown>): Record<string, unknown> {
	if (raw.type === undefined || raw.type === 'command') {
		return { ...raw, type: 'command' };
	}
	return raw;
}

function yamlValueToPlain(value: IValue): unknown {
	switch (value.type) {
		case 'scalar':
			return value.value;
		case 'sequence':
			return value.items.map(yamlValueToPlain);
		case 'map': {
			const obj: Record<string, unknown> = {};
			for (const prop of value.properties) {
				obj[prop.key.value] = yamlValueToPlain(prop.value);
			}
			return obj;
		}
	}
}

export function parseSubagentHooksFromYaml(
	hooksMap: IMapValue,
	workspaceRootUri: URI | undefined,
	userHome: string,
	target: Target = Target.Undefined,
): ChatRequestHooks {
	const result: Record<string, IHookCommand[]> = {};
	const targetHookMap = HOOKS_BY_TARGET[target] ?? HOOKS_BY_TARGET[Target.Undefined];

	for (const prop of hooksMap.properties) {
		const hookTypeName = prop.key.value;

		const hookType = targetHookMap[hookTypeName] ?? toHookType(hookTypeName);
		if (!hookType) {
			continue;
		}

		if (prop.value.type !== 'sequence') {
			continue;
		}

		const commands: IHookCommand[] = [];

		for (const item of prop.value.items) {
			const plainItem = yamlValueToPlain(item);
			const extracted = extractHookCommandsFromItem(plainItem, workspaceRootUri, userHome);
			commands.push(...extracted);
		}

		if (commands.length > 0) {
			if (!result[hookType]) {
				result[hookType] = [];
			}
			result[hookType].push(...commands);
		}
	}

	return result as ChatRequestHooks;
}
