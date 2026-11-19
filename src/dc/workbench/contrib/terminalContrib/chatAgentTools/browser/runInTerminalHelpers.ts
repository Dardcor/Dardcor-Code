/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Separator } from '../../../../../base/common/actions.js';
import { coalesce } from '../../../../../base/common/arrays.js';
import { posix as pathPosix, win32 as pathWin32 } from '../../../../../base/common/path.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { escapeRegExpCharacters } from '../../../../../base/common/strings.js';
import { localize } from '../../../../../nls.js';
import type { TerminalNewAutoApproveButtonData } from '../../../chat/browser/widget/chatContentParts/toolInvocationParts/chatTerminalToolConfirmationSubPart.js';
import type { ToolConfirmationAction } from '../../../chat/common/tools/languageModelToolsService.js';
import type { ICommandApprovalResultWithReason } from './tools/commandLineAnalyzer/autoApprove/commandLineAutoApprover.js';
import { isAutoApproveRule } from './tools/commandLineAnalyzer/commandLineAnalyzer.js';

export function isPowerShell(envShell: string, os: OperatingSystem): boolean {
	if (os === OperatingSystem.Windows) {
		return /^(?:powershell|pwsh)(?:-preview)?$/i.test(pathWin32.basename(envShell).replace(/\.exe$/i, ''));

	}
	return /^(?:powershell|pwsh)(?:-preview)?$/.test(pathPosix.basename(envShell));
}

export function isWindowsPowerShell(envShell: string): boolean {
	return envShell.endsWith('System32\\WindowsPowerShell\\v1.0\\powershell.exe');
}

export function isZsh(envShell: string, os: OperatingSystem): boolean {
	if (os === OperatingSystem.Windows) {
		return /^zsh(?:\.exe)?$/i.test(pathWin32.basename(envShell));
	}
	return /^zsh$/.test(pathPosix.basename(envShell));
}

export function isBash(envShell: string, os: OperatingSystem): boolean {
	if (os === OperatingSystem.Windows) {
		return /^bash(?:\.exe)?$/i.test(pathWin32.basename(envShell));
	}
	return /^bash$/.test(pathPosix.basename(envShell));
}

export function isFish(envShell: string, os: OperatingSystem): boolean {
	if (os === OperatingSystem.Windows) {
		return /^fish(?:\.exe)?$/i.test(pathWin32.basename(envShell));
	}
	return /^fish$/.test(pathPosix.basename(envShell));
}

export const TRUNCATION_MESSAGE = '\n\n[... PREVIOUS OUTPUT TRUNCATED ...]\n\n';

export function truncateOutputKeepingTail(output: string, maxLength: number): string {
	if (output.length <= maxLength) {
		return output;
	}
	const truncationMessageLength = TRUNCATION_MESSAGE.length;
	if (truncationMessageLength >= maxLength) {
		return TRUNCATION_MESSAGE.slice(TRUNCATION_MESSAGE.length - maxLength);
	}
	const availableLength = maxLength - truncationMessageLength;
	const endPortion = output.slice(-availableLength);
	return TRUNCATION_MESSAGE + endPortion;
}

export function normalizeTerminalCommandForDisplay(commandLine: string): string {
	return commandLine.replace(/\\(["'\/])/g, '$1');
}

export function buildCommandDisplayText(command: string): string {
	const normalized = normalizeTerminalCommandForDisplay(command).replace(/\r\n|\r|\n/g, ' ');
	return normalized.length > 80 ? normalized.substring(0, 77) + '...' : normalized;
}

export function normalizeCommandForExecution(command: string): string {
	return command.replace(/\r\n|\r|\n/g, ' ').trim();
}

export function isMultilineCommand(command: string): boolean {
	const normalized = command.replace(/\r\n|\r/g, '\n');
	return /(?<!\\)\n/.test(normalized);
}

export function generateAutoApproveActions(commandLine: string, subCommands: string[], autoApproveResult: { subCommandResults: ICommandApprovalResultWithReason[]; commandLineResult: ICommandApprovalResultWithReason }, options?: { skipSessionScoped?: boolean }): ToolConfirmationAction[] {
	const actions: ToolConfirmationAction[] = [];

	const canCreateAutoApproval = (
		autoApproveResult.subCommandResults.every(e => e.result !== 'denied') &&
		autoApproveResult.commandLineResult.result !== 'denied'
	);
	if (canCreateAutoApproval) {
		const unapprovedSubCommands = subCommands.filter((_, index) => {
			return autoApproveResult.subCommandResults[index].result !== 'approved';
		});

		const neverAutoApproveCommands = new Set([
			'bash', 'sh', 'zsh', 'fish', 'ksh', 'csh', 'tcsh', 'dash',
			'pwsh', 'powershell', 'powershell.exe', 'cmd', 'cmd.exe',
			'python', 'python3', 'node', 'ruby', 'perl', 'php', 'lua',
			'eval', 'exec', 'source', 'sudo', 'su', 'doas',
			'curl', 'wget', 'invoke-restmethod', 'invoke-webrequest', 'irm', 'iwr',
		]);

		const commandsWithSubcommands = new Set(['git', 'npm', 'npx', 'yarn', 'docker', 'kubectl', 'cargo', 'dotnet', 'mvn', 'gradle']);

		const commandsWithSubSubCommands = new Set(['npm run', 'yarn run']);

		const findNextNonFlagArg = (parts: string[], startIndex: number): number | undefined => {
			for (let i = startIndex; i < parts.length; i++) {
				if (!parts[i].startsWith('-')) {
					return i;
				}
			}
			return undefined;
		};

		const subCommandsToSuggest = Array.from(new Set(coalesce(unapprovedSubCommands.map(command => {
			const parts = command.trim().split(/\s+/);
			const baseCommand = parts[0].toLowerCase();

			if (neverAutoApproveCommands.has(baseCommand)) {
				return undefined;
			}

			if (commandsWithSubcommands.has(baseCommand)) {
				const subCommandIndex = findNextNonFlagArg(parts, 1);
				if (subCommandIndex !== undefined) {
					const baseSubCommand = `${parts[0]} ${parts[subCommandIndex]}`.toLowerCase();
					if (commandsWithSubSubCommands.has(baseSubCommand)) {
						const subSubCommandIndex = findNextNonFlagArg(parts, subCommandIndex + 1);
						if (subSubCommandIndex !== undefined) {
							return parts.slice(0, subSubCommandIndex + 1).join(' ');
						}
						return undefined;
					} else {
						return parts.slice(0, subCommandIndex + 1).join(' ');
					}
				}
				return undefined;
			} else {
				return parts[0];
			}
		}))));

		if (subCommandsToSuggest.length > 0) {
			let subCommandLabel: string;
			if (subCommandsToSuggest.length === 1) {
				subCommandLabel = `\`${subCommandsToSuggest[0]} \u2026\``;
			} else {
				subCommandLabel = `Commands ${subCommandsToSuggest.map(e => `\`${e} \u2026\``).join(', ')}`;
			}

			if (!options?.skipSessionScoped) {
				actions.push({
					label: `Allow ${subCommandLabel} in this Session`,
					data: {
						type: 'newRule',
						rule: subCommandsToSuggest.map(key => ({
							key,
							value: true,
							scope: 'session'
						}))
					} satisfies TerminalNewAutoApproveButtonData
				});
			}
			actions.push({
				label: `Allow ${subCommandLabel} in this Workspace`,
				data: {
					type: 'newRule',
					rule: subCommandsToSuggest.map(key => ({
						key,
						value: true,
						scope: 'workspace'
					}))
				} satisfies TerminalNewAutoApproveButtonData
			});
			actions.push({
				label: `Always Allow ${subCommandLabel}`,
				data: {
					type: 'newRule',
					rule: subCommandsToSuggest.map(key => ({
						key,
						value: true,
						scope: 'user'
					}))
				} satisfies TerminalNewAutoApproveButtonData
			});
		}

		if (actions.length > 0) {
			actions.push(new Separator());
		}

		const firstSubcommandFirstWord = unapprovedSubCommands.length > 0 ? unapprovedSubCommands[0].split(' ')[0] : '';
		if (
			firstSubcommandFirstWord !== commandLine &&
			!commandsWithSubcommands.has(commandLine) &&
			!commandsWithSubSubCommands.has(commandLine)
		) {
			if (!options?.skipSessionScoped) {
				actions.push({
					label: localize('autoApprove.exactCommand1', 'Allow Exact Command Line in this Session'),
					data: {
						type: 'newRule',
						rule: {
							key: `/^${escapeRegExpCharacters(commandLine)}$/`,
							value: {
								approve: true,
								matchCommandLine: true
							},
							scope: 'session'
						}
					} satisfies TerminalNewAutoApproveButtonData
				});
			}
			actions.push({
				label: localize('autoApprove.exactCommand2', 'Allow Exact Command Line in this Workspace'),
				data: {
					type: 'newRule',
					rule: {
						key: `/^${escapeRegExpCharacters(commandLine)}$/`,
						value: {
							approve: true,
							matchCommandLine: true
						},
						scope: 'workspace'
					}
				} satisfies TerminalNewAutoApproveButtonData
			});
			actions.push({
				label: localize('autoApprove.exactCommand', 'Always Allow Exact Command Line'),
				data: {
					type: 'newRule',
					rule: {
						key: `/^${escapeRegExpCharacters(commandLine)}$/`,
						value: {
							approve: true,
							matchCommandLine: true
						},
						scope: 'user'
					}
				} satisfies TerminalNewAutoApproveButtonData
			});
		}
	}

	if (actions.length > 0) {
		actions.push(new Separator());
	}


	if (!options?.skipSessionScoped) {
		actions.push({
			label: localize('allowSession', 'Allow All Commands in this Session'),
			tooltip: localize('allowSessionTooltip', 'Allow this tool to run in this session without confirmation.'),
			data: {
				type: 'sessionApproval'
			} satisfies TerminalNewAutoApproveButtonData
		});

		actions.push(new Separator());
	}

	actions.push({
		label: localize('autoApprove.configure', 'Configure Auto Approve...'),
		data: {
			type: 'configure'
		} satisfies TerminalNewAutoApproveButtonData
	});

	return actions;
}

export function dedupeRules(rules: ICommandApprovalResultWithReason[]): ICommandApprovalResultWithReason[] {
	return rules.filter((result, index, array) => {
		if (!isAutoApproveRule(result.rule)) {
			return false;
		}
		const sourceText = result.rule.sourceText;
		return array.findIndex(r => isAutoApproveRule(r.rule) && r.rule.sourceText === sourceText) === index;
	});
}

export interface IExtractedCdPrefix {
	directory: string;
	command: string;
}

export function extractCdPrefix(commandLine: string, shell: string, os: OperatingSystem): IExtractedCdPrefix | undefined {
	const isPwsh = isPowerShell(shell, os);

	const cdPrefixMatch = commandLine.match(
		isPwsh
			? /^(?:cd(?: \/d)?|Set-Location(?: -Path)?) (?<dir>[^\s]+) ?(?:&&|;)\s+(?<suffix>.+)$/i
			: /^cd (?<dir>[^\s]+) &&\s+(?<suffix>.+)$/
	);
	const cdDir = cdPrefixMatch?.groups?.dir;
	const cdSuffix = cdPrefixMatch?.groups?.suffix;
	if (cdDir && cdSuffix) {
		let cdDirPath = cdDir;
		if (cdDirPath.startsWith('"') && cdDirPath.endsWith('"')) {
			cdDirPath = cdDirPath.slice(1, -1);
		}
		return { directory: cdDirPath, command: cdSuffix };
	}
	return undefined;
}
