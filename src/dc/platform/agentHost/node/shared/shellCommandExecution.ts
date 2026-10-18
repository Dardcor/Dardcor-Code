/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import * as platform from '../../../../base/common/platform.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ILogService } from '../../../log/common/log.js';
import { TerminalClaimKind } from '../../common/state/protocol/state.js';
import { IAgentHostTerminalManager } from '../agentHostTerminalManager.js';

export const SHELL_COMMAND_MAX_OUTPUT_BYTES = 80_000;

export const DEFAULT_SHELL_COMMAND_TIMEOUT_MS = 120_000;

const SENTINEL_PREFIX = '<<<COPILOT_SENTINEL_';

export type ShellType = 'bash' | 'powershell';

export function shellTypeForExecutable(shellPath: string): ShellType {
	const lastSep = Math.max(shellPath.lastIndexOf('/'), shellPath.lastIndexOf('\\'));
	const base = shellPath.slice(lastSep + 1).toLowerCase().replace(/\.exe$/, '');
	switch (base) {
		case 'pwsh':
		case 'powershell':
		case 'pwsh-preview':
			return 'powershell';
		case 'bash':
		case 'sh':
		case 'zsh':
		case 'fish':
		case 'csh':
		case 'ksh':
		case 'nu':
		case 'xonsh':
		case 'git-cmd':
		case 'wsl':
		case 'ubuntu':
		case 'ubuntu1804':
		case 'kali':
		case 'debian':
		case 'opensuse-42':
		case 'sles-12':
			return 'bash';
		default:
			return platform.isWindows ? 'powershell' : 'bash';
	}
}

export function prefixForHistorySuppression(shellType: ShellType): string {
	return shellType === 'powershell' ? '' : ' ';
}

export function isMultilineCommand(command: string): boolean {
	const normalized = command.replace(/\r\n|\r/g, '\n');
	return /(?<!\\)\n/.test(normalized);
}

function shouldUseBracketedPasteMode(command: string): boolean {
	return platform.isMacintosh || isMultilineCommand(command);
}

function makeSentinelId(): string {
	return generateUuid().replace(/-/g, '');
}

function buildSentinelCommand(sentinelId: string, shellType: ShellType): string {
	if (shellType === 'powershell') {
		return `Write-Output "${SENTINEL_PREFIX}${sentinelId}_EXIT_$LASTEXITCODE>>>"`;
	}
	return `echo "${SENTINEL_PREFIX}${sentinelId}_EXIT_$?>>>"`;
}

function parseSentinel(content: string, sentinelId: string): { found: boolean; exitCode: number; outputBeforeSentinel: string } {
	const marker = `${SENTINEL_PREFIX}${sentinelId}_EXIT_`;
	let markerIndex = content.lastIndexOf(marker);
	while (markerIndex !== -1) {
		const outputBeforeSentinel = content.substring(0, markerIndex);
		const afterMarker = content.substring(markerIndex + marker.length);
		const endIdx = afterMarker.indexOf('>>>');
		if (endIdx !== -1) {
			const exitCodeStr = afterMarker.substring(0, endIdx).trim();
			if (/^-?\d+$/.test(exitCodeStr)) {
				return {
					found: true,
					exitCode: parseInt(exitCodeStr, 10),
					outputBeforeSentinel,
				};
			}
		}
		markerIndex = content.lastIndexOf(marker, markerIndex - 1);
	}

	return { found: false, exitCode: -1, outputBeforeSentinel: content };
}

export function prepareOutputForModel(rawOutput: string): string {
	let text = removeAnsiEscapeCodes(rawOutput).trim();
	if (text.length > SHELL_COMMAND_MAX_OUTPUT_BYTES) {
		text = text.substring(text.length - SHELL_COMMAND_MAX_OUTPUT_BYTES);
	}
	return text;
}

export interface IShellCommandTarget {
	readonly terminalUri: string;
	readonly shellType: ShellType;
}

export type ShellCommandStatus = 'completed' | 'timeout' | 'background' | 'altBuffer' | 'shellExited';

export interface IShellCommandResult {
	readonly status: ShellCommandStatus;
	readonly exitCode?: number;
	readonly output: string;
}

export function executeShellCommand(
	target: IShellCommandTarget,
	command: string,
	timeoutMs: number,
	terminalManager: IAgentHostTerminalManager,
	logService: ILogService,
): Promise<IShellCommandResult> {
	return terminalManager.supportsCommandDetection(target.terminalUri)
		? executeCommandWithShellIntegration(target, command, timeoutMs, terminalManager, logService)
		: executeCommandWithSentinel(target, command, timeoutMs, terminalManager, logService);
}

function registerAltBufferHandler(
	target: IShellCommandTarget,
	terminalManager: IAgentHostTerminalManager,
	logService: ILogService,
	disposables: DisposableStore,
	finish: (result: IShellCommandResult) => void,
): void {
	void terminalManager.createAltBufferPromise(target.terminalUri, disposables).then(() => {
		logService.info('[ShellCommand] Command entered alternate buffer');
		finish({ status: 'altBuffer', output: '' });
	});
}

async function executeCommandWithShellIntegration(
	target: IShellCommandTarget,
	command: string,
	timeoutMs: number,
	terminalManager: IAgentHostTerminalManager,
	logService: ILogService,
): Promise<IShellCommandResult> {
	const disposables = new DisposableStore();

	const result = new Promise<IShellCommandResult>(resolve => {
		let resolved = false;
		const finish = (result: IShellCommandResult) => {
			if (resolved) {
				return;
			}
			resolved = true;
			disposables.dispose();
			resolve(result);
		};

		disposables.add(terminalManager.onCommandFinished(target.terminalUri, event => {
			const output = prepareOutputForModel(event.output);
			const exitCode = event.exitCode ?? 0;
			logService.info(`[ShellCommand] Command completed (shell integration) with exit code ${exitCode}`);
			finish({ status: 'completed', exitCode, output });
		}));

		registerAltBufferHandler(target, terminalManager, logService, disposables, finish);

		disposables.add(terminalManager.onExit(target.terminalUri, (exitCode: number) => {
			logService.info(`[ShellCommand] Shell exited unexpectedly with code ${exitCode}`);
			const fullContent = terminalManager.getContent(target.terminalUri) ?? '';
			finish({ status: 'shellExited', exitCode, output: prepareOutputForModel(fullContent) });
		}));

		disposables.add(terminalManager.onClaimChanged(target.terminalUri, (claim) => {
			if (claim.kind === TerminalClaimKind.Session && !claim.toolCallId) {
				logService.info(`[ShellCommand] Continuing in background (claim narrowed)`);
				finish({ status: 'background', output: '' });
			}
		}));

		const timer = setTimeout(() => {
			logService.warn(`[ShellCommand] Command timed out after ${timeoutMs}ms`);
			const fullContent = terminalManager.getContent(target.terminalUri) ?? '';
			finish({ status: 'timeout', output: prepareOutputForModel(fullContent) });
		}, timeoutMs);
		disposables.add(toDisposable(() => clearTimeout(timer)));

	});

	try {
		await terminalManager.sendText(target.terminalUri, `${prefixForHistorySuppression(target.shellType)}${command}`, {
			shouldExecute: true,
			bracketedPasteMode: shouldUseBracketedPasteMode(command),
		});
	} catch (err) {
		disposables.dispose();
		throw err;
	}

	return result;
}

async function executeCommandWithSentinel(
	target: IShellCommandTarget,
	command: string,
	timeoutMs: number,
	terminalManager: IAgentHostTerminalManager,
	logService: ILogService,
): Promise<IShellCommandResult> {
	const sentinelId = makeSentinelId();
	const sentinelCmd = buildSentinelCommand(sentinelId, target.shellType);
	const disposables = new DisposableStore();

	const contentBefore = terminalManager.getContent(target.terminalUri) ?? '';
	const offsetBefore = contentBefore.length;

	const result = new Promise<IShellCommandResult>(resolve => {
		let resolved = false;
		const finish = (result: IShellCommandResult) => {
			if (resolved) {
				return;
			}
			resolved = true;
			disposables.dispose();
			resolve(result);
		};

		const checkForSentinel = () => {
			const fullContent = terminalManager.getContent(target.terminalUri) ?? '';
			const clampedOffset = Math.min(offsetBefore, fullContent.length);
			const newContent = fullContent.substring(clampedOffset);
			const parsed = parseSentinel(newContent, sentinelId);
			if (parsed.found) {
				const output = prepareOutputForModel(parsed.outputBeforeSentinel);
				logService.info(`[ShellCommand] Command completed with exit code ${parsed.exitCode}`);
				finish({ status: 'completed', exitCode: parsed.exitCode, output });
			}
		};

		disposables.add(terminalManager.onData(target.terminalUri, () => {
			checkForSentinel();
		}));

		registerAltBufferHandler(target, terminalManager, logService, disposables, finish);

		disposables.add(terminalManager.onExit(target.terminalUri, (exitCode: number) => {
			logService.info(`[ShellCommand] Shell exited unexpectedly with code ${exitCode}`);
			const fullContent = terminalManager.getContent(target.terminalUri) ?? '';
			const newContent = fullContent.substring(offsetBefore);
			finish({ status: 'shellExited', exitCode, output: prepareOutputForModel(newContent) });
		}));

		disposables.add(terminalManager.onClaimChanged(target.terminalUri, (claim) => {
			if (claim.kind === TerminalClaimKind.Session && !claim.toolCallId) {
				logService.info(`[ShellCommand] Continuing in background (claim narrowed)`);
				finish({ status: 'background', output: '' });
			}
		}));

		const timer = setTimeout(() => {
			logService.warn(`[ShellCommand] Command timed out after ${timeoutMs}ms`);
			const fullContent = terminalManager.getContent(target.terminalUri) ?? '';
			const newContent = fullContent.substring(offsetBefore);
			finish({ status: 'timeout', output: prepareOutputForModel(newContent) });
		}, timeoutMs);
		disposables.add(toDisposable(() => clearTimeout(timer)));

		checkForSentinel();
	});

	try {
		await terminalManager.sendText(target.terminalUri, `${prefixForHistorySuppression(target.shellType)}${command}`, {
			shouldExecute: true,
			bracketedPasteMode: shouldUseBracketedPasteMode(command),
		});
		await terminalManager.sendText(target.terminalUri, sentinelCmd, { shouldExecute: true });
	} catch (err) {
		disposables.dispose();
		throw err;
	}

	return result;
}
