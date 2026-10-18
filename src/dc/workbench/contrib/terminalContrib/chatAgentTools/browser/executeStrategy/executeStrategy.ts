/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, RunOnceScheduler } from '../../../../../../base/common/async.js';
import type { CancellationToken } from '../../../../../../base/common/cancellation.js';
import type { Event } from '../../../../../../base/common/event.js';
import { DisposableStore, type IDisposable } from '../../../../../../base/common/lifecycle.js';
import type { ITerminalLogService } from '../../../../../../platform/terminal/common/terminal.js';
import type { ITerminalInstance } from '../../../../terminal/browser/terminal.js';
import type { IMarker as IXtermMarker } from '@xterm/xterm';

export interface ITerminalExecuteStrategy extends IDisposable {
	readonly type: 'rich' | 'basic' | 'none';
	execute(commandLine: string, token: CancellationToken, commandId?: string, commandLineForMetadata?: string): Promise<ITerminalExecuteStrategyResult>;

	readonly onDidCreateStartMarker: Event<IXtermMarker | undefined>;
}

export interface ITerminalExecuteStrategyResult {
	output: string | undefined;
	additionalInformation?: string;
	exitCode?: number;
	error?: string;
	didEnterAltBuffer?: boolean;
}

export async function waitForIdle(onData: Event<unknown>, idleDurationMs: number): Promise<void> {
	const store = new DisposableStore();
	const deferred = new DeferredPromise<void>();
	const scheduler = store.add(new RunOnceScheduler(() => deferred.complete(), idleDurationMs));
	store.add(onData(() => scheduler.schedule()));
	scheduler.schedule();
	return deferred.p.finally(() => store.dispose());
}

export interface IPromptDetectionResult {
	detected: boolean;
	reason?: string;
}

export function detectsCommonPromptPattern(cursorLine: string): IPromptDetectionResult {
	if (cursorLine.trim().length === 0) {
		return { detected: false, reason: 'Content is empty or contains only whitespace' };
	}

	if (/PS\s+[A-Z]:\\.*>\s*$/.test(cursorLine)) {
		return { detected: true, reason: `PowerShell prompt pattern detected: "${cursorLine}"` };
	}

	if (/^[A-Z]:\\.*>\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Command Prompt pattern detected: "${cursorLine}"` };
	}

	if (/\$\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Bash-style prompt pattern detected: "${cursorLine}"` };
	}

	if (/#\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Root prompt pattern detected: "${cursorLine}"` };
	}

	if (/^>>>\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Python REPL prompt pattern detected: "${cursorLine}"` };
	}

	if (/\u276f\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Starship prompt pattern detected: "${cursorLine}"` };
	}

	if (/[>%]\s*$/.test(cursorLine)) {
		return { detected: true, reason: `Generic prompt pattern detected: "${cursorLine}"` };
	}

	return { detected: false, reason: `No common prompt pattern found in last line: "${cursorLine}"` };
}

export async function waitForIdleWithPromptHeuristics(
	onData: Event<unknown>,
	instance: ITerminalInstance,
	idlePollIntervalMs: number,
	extendedTimeoutMs: number,
): Promise<IPromptDetectionResult> {
	await waitForIdle(onData, idlePollIntervalMs);

	const xterm = await instance.xtermReadyPromise;
	if (!xterm) {
		return { detected: false, reason: `Xterm not available, using ${idlePollIntervalMs}ms timeout` };
	}
	const startTime = Date.now();

	while (Date.now() - startTime < extendedTimeoutMs) {
		try {
			let content = '';
			const buffer = xterm.raw.buffer.active;
			const line = buffer.getLine(buffer.baseY + buffer.cursorY);
			if (line) {
				content = line.translateToString(true);
			}
			const promptResult = detectsCommonPromptPattern(content);
			if (promptResult.detected) {
				return promptResult;
			}
		} catch (error) {
		}
		await waitForIdle(onData, Math.min(idlePollIntervalMs, extendedTimeoutMs - (Date.now() - startTime)));
	}

	try {
		let content = '';
		const buffer = xterm.raw.buffer.active;
		const line = buffer.getLine(buffer.baseY + buffer.cursorY);
		if (line) {
			content = line.translateToString(true) + '\n';
		}
		return { detected: false, reason: `Extended timeout reached without prompt detection. Last line: "${content.trim()}"` };
	} catch (error) {
		return { detected: false, reason: `Extended timeout reached. Error reading terminal content: ${error}` };
	}
}

export interface ITrackIdleOnPromptOptions {
	disableFallbacks?: boolean;
}

export async function trackIdleOnPrompt(
	instance: ITerminalInstance,
	idleDurationMs: number,
	store: DisposableStore,
	promptFallbackMs?: number,
	logService?: ITerminalLogService,
	options?: ITrackIdleOnPromptOptions,
): Promise<void> {
	const idleOnPrompt = new DeferredPromise<void>();
	const onData = instance.onData;
	const log = logService ? (msg: string) => logService.info(`trackIdleOnPrompt: ${msg}`) : undefined;

	const enum TerminalState {
		Initial,
		Prompt,
		Executing,
		PromptAfterExecuting,
	}
	const stateNames: Record<TerminalState, string> = {
		[TerminalState.Initial]: 'Initial',
		[TerminalState.Prompt]: 'Prompt',
		[TerminalState.Executing]: 'Executing',
		[TerminalState.PromptAfterExecuting]: 'PromptAfterExecuting',
	};

	let state: TerminalState = TerminalState.Initial;
	let dataEventCount = 0;

	function setState(newState: TerminalState, reason: string): void {
		if (state !== newState) {
			log?.(`State ${stateNames[state]} → ${stateNames[newState]} (${reason})`);
			state = newState;
		}
	}

	const scheduler = store.add(new RunOnceScheduler(() => {
		log?.(`Idle scheduler fired, completing (dataEvents=${dataEventCount})`);
		idleOnPrompt.complete();
	}, idleDurationMs));

	const promptFallbackScheduler = store.add(new RunOnceScheduler(() => {
		if (state === TerminalState.Executing || state === TerminalState.PromptAfterExecuting) {
			promptFallbackScheduler.cancel();
			return;
		}
		log?.(`Prompt fallback fired (dataEvents=${dataEventCount})`);
		setState(TerminalState.PromptAfterExecuting, 'promptFallback');
		scheduler.schedule();
	}, promptFallbackMs ?? 1000));
	const disableFallbacks = options?.disableFallbacks ?? false;
	const initialFallbackScheduler = store.add(new RunOnceScheduler(() => {
		if (state === TerminalState.Executing || state === TerminalState.PromptAfterExecuting) {
			log?.(`Initial fallback fired but state is ${stateNames[state]}, skipping`);
			return;
		}
		log?.(`Initial fallback fired, no data events received`);
		setState(TerminalState.PromptAfterExecuting, 'initialFallback');
		scheduler.schedule();
	}, 10_000));
	if (!disableFallbacks) {
		initialFallbackScheduler.schedule();
	}
	const executingFallbackScheduler = store.add(new RunOnceScheduler(() => {
		if (state === TerminalState.Executing) {
			log?.(`Executing fallback fired after 30s data-idle (dataEvents=${dataEventCount})`);
			setState(TerminalState.PromptAfterExecuting, 'executingFallback');
			scheduler.schedule();
		}
	}, 30_000));
	const hardCapScheduler = store.add(new RunOnceScheduler(() => {
		if (state === TerminalState.Initial || state === TerminalState.Prompt) {
			log?.(`Hard cap fired after 5min in state ${stateNames[state]} (dataEvents=${dataEventCount})`);
			setState(TerminalState.PromptAfterExecuting, 'hardCap');
			scheduler.schedule();
		}
	}, 60_000));
	if (!disableFallbacks) {
		hardCapScheduler.schedule();
	}
	store.add(onData(e => {
		dataEventCount++;
		initialFallbackScheduler.cancel();
		const matches = e.matchAll(/(?:\x1b\]|\x9d)[16]33;(?<type>[ACD])(?:;.*)?(?:\x1b\\|\x07|\x9c)/g);
		for (const match of matches) {
			if (match.groups?.type === 'A') {
				if (state === TerminalState.Initial) {
					setState(TerminalState.Prompt, 'sequence A');
				} else if (state === TerminalState.Executing) {
					setState(TerminalState.PromptAfterExecuting, 'sequence A after executing');
					executingFallbackScheduler.cancel();
				}
			} else if (match.groups?.type === 'C' || match.groups?.type === 'D') {
				setState(TerminalState.Executing, `sequence ${match.groups?.type}`);
				if (!disableFallbacks) {
					executingFallbackScheduler.schedule();
				}
			}
		}
		if (state === TerminalState.PromptAfterExecuting) {
			promptFallbackScheduler.cancel();
			executingFallbackScheduler.cancel();
			scheduler.schedule();
		} else {
			scheduler.cancel();
			if (state === TerminalState.Initial || state === TerminalState.Prompt) {
				if (!disableFallbacks) {
					promptFallbackScheduler.schedule();
				}
			} else {
				promptFallbackScheduler.cancel();
				if (!disableFallbacks) {
					executingFallbackScheduler.schedule();
				}
			}
		}
	}));
	return idleOnPrompt.p;
}
