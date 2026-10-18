/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../../../base/common/event.js';
import { Disposable, MutableDisposable, toDisposable, type IDisposable } from '../../../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../../../nls.js';
import { IToolInvocationContext } from '../../../../../chat/common/tools/languageModelToolsService.js';
import { ITaskService } from '../../../../../tasks/common/taskService.js';
import { ILinkLocation } from '../../taskHelpers.js';
import { IExecution, IPollingResult, OutputMonitorState, PollingConsts } from './types.js';
import { ITerminalLogService } from '../../../../../../../platform/terminal/common/terminal.js';

export interface IOutputMonitor extends Disposable {
	readonly pollingResult: IPollingResult & { pollDurationMs: number } | undefined;
	readonly outputMonitorTelemetryCounters: IOutputMonitorTelemetryCounters;

	readonly onDidFinishCommand: Event<void>;
	readonly onDidDetectInputNeeded: Event<void>;
	readonly onDidDetectSensitiveInputNeeded: Event<void>;
}

export interface IOutputMonitorTelemetryCounters {
	inputToolManualAcceptCount: number;
	inputToolManualRejectCount: number;
	inputToolManualChars: number;
	inputToolAutoAcceptCount: number;
	inputToolAutoChars: number;
	inputToolManualShownCount: number;
	inputToolFreeFormInputShownCount: number;
	inputToolFreeFormInputCount: number;
}

export function getLastLine(output: string | undefined): string {
	if (!output) {
		return '';
	}
	const trimmedOutput = output.replace(/[\r\n]+$/, '');
	if (!trimmedOutput) {
		return '';
	}
	const lastLineFeed = trimmedOutput.lastIndexOf('\n');
	const lastLine = lastLineFeed === -1 ? trimmedOutput : trimmedOutput.slice(lastLineFeed + 1);
	const lastCarriageReturn = lastLine.lastIndexOf('\r');
	return lastCarriageReturn === -1 ? lastLine : lastLine.slice(lastCarriageReturn + 1);
}

export class OutputMonitor extends Disposable implements IOutputMonitor {
	private _state: OutputMonitorState = OutputMonitorState.PollingForIdle;
	get state(): OutputMonitorState { return this._state; }

	private _formatLastLineForLog(output: string | undefined): string {
		if (!output) {
			return '<empty>';
		}
		const lastLine = getLastLine(output).trimEnd();
		if (!lastLine) {
			return '<empty>';
		}
		if (this._isSensitivePrompt(lastLine)) {
			return '<redacted>';
		}
		return lastLine.length > 200 ? lastLine.slice(0, 200) + '…' : lastLine;
	}

	private _pollingResult: IPollingResult & { pollDurationMs: number } | undefined;
	get pollingResult(): IPollingResult & { pollDurationMs: number } | undefined { return this._pollingResult; }

	private _userInputtedSinceIdleDetected = false;
	private readonly _userInputListener = this._register(new MutableDisposable<IDisposable>());

	private readonly _outputMonitorTelemetryCounters: IOutputMonitorTelemetryCounters = {
		inputToolManualAcceptCount: 0,
		inputToolManualRejectCount: 0,
		inputToolManualChars: 0,
		inputToolAutoAcceptCount: 0,
		inputToolAutoChars: 0,
		inputToolManualShownCount: 0,
		inputToolFreeFormInputShownCount: 0,
		inputToolFreeFormInputCount: 0,
	};
	get outputMonitorTelemetryCounters(): Readonly<IOutputMonitorTelemetryCounters> { return this._outputMonitorTelemetryCounters; }

	private readonly _onDidFinishCommand = this._register(new Emitter<void>());
	readonly onDidFinishCommand: Event<void> = this._onDidFinishCommand.event;

	private readonly _onDidDetectInputNeeded = this._register(new Emitter<void>());
	readonly onDidDetectInputNeeded: Event<void> = this._onDidDetectInputNeeded.event;

	private readonly _onDidDetectSensitiveInputNeeded = this._register(new Emitter<void>());
	readonly onDidDetectSensitiveInputNeeded: Event<void> = this._onDidDetectSensitiveInputNeeded.event;

	private _asyncMode = false;
	private _command = '';
	private _invocationContext: IToolInvocationContext | undefined;
	private _currentMonitoringCts: CancellationTokenSource | undefined;
	private _didFinish = false;

	private _fireFinishedOnce(): void {
		if (this._didFinish) {
			return;
		}
		this._didFinish = true;
		this._onDidFinishCommand.fire();
	}

	override dispose(): void {
		if (!this._didFinish) {
			this._pollingResult ??= {
				state: OutputMonitorState.Cancelled,
				output: this._execution.getOutput(),
				pollDurationMs: 0,
				resources: undefined,
			};
		}
		this._fireFinishedOnce();
		super.dispose();
	}

	constructor(
		private readonly _execution: IExecution,
		private readonly _pollFn: ((execution: IExecution, token: CancellationToken, taskService: ITaskService) => Promise<IPollingResult | undefined>) | undefined,
		invocationContext: IToolInvocationContext | undefined,
		token: CancellationToken,
		command: string,
		@ITaskService private readonly _taskService: ITaskService,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
	) {
		super();

		this._command = command;
		this._invocationContext = invocationContext;

		const cts = new CancellationTokenSource(token);
		this._currentMonitoringCts = cts;
		this._register(toDisposable(() => {
			this._currentMonitoringCts?.cancel();
			this._currentMonitoringCts?.dispose();
		}));

		timeout(0).then(() => {
			if (this._currentMonitoringCts !== cts) {
				return;
			}
			this._startMonitoring(command, invocationContext, cts.token);
		});
	}

	private async _startMonitoring(
		command: string,
		invocationContext: IToolInvocationContext | undefined,
		token: CancellationToken
	): Promise<void> {
		const pollStartTime = Date.now();

		let resources;
		let output;

		let extended = false;
		try {
			while (!token.isCancellationRequested) {
				switch (this._state) {
					case OutputMonitorState.PollingForIdle: {
						this._logService.trace(`OutputMonitor: Entering PollingForIdle (extended=${extended})`);
						this._state = await this._waitForIdle(this._execution, extended, token);
						this._logService.trace(`OutputMonitor: PollingForIdle completed -> state=${OutputMonitorState[this._state]}`);
						continue;
					}
					case OutputMonitorState.Timeout: {
						this._logService.trace(`OutputMonitor: Entering Timeout state (extended=${extended})`);
						const shouldContinuePolling = await this._handleTimeoutState(command, invocationContext, extended, token);
						if (shouldContinuePolling) {
							extended = true;
							this._state = OutputMonitorState.PollingForIdle;
							continue;
						} else if (this._asyncMode) {
							this._logService.trace('OutputMonitor: Async mode - timeout reached, waiting for new terminal data');
							extended = false;
							await this._waitForNewData(token);
							if (token.isCancellationRequested) {
								break;
							}
							this._state = OutputMonitorState.PollingForIdle;
							continue;
						} else {
							break;
						}
					}
					case OutputMonitorState.Cancelled:
						break;
					case OutputMonitorState.Idle: {
						this._logService.trace('OutputMonitor: Entering Idle handler');
						const idleResult = await this._handleIdleState(token);
						if (idleResult.shouldContinuePolling) {
							this._logService.trace('OutputMonitor: Idle handler -> continue polling');
							this._state = OutputMonitorState.PollingForIdle;
							continue;
						} else if (this._asyncMode) {
							this._logService.trace('OutputMonitor: Async mode - waiting for new terminal data before next monitoring cycle');
							await this._waitForNewData(token);
							if (token.isCancellationRequested) {
								break;
							}
							this._state = OutputMonitorState.PollingForIdle;
							continue;
						} else {
							this._logService.trace(`OutputMonitor: Idle handler -> stop polling (hasResources=${!!idleResult.resources}, outputLen=${idleResult.output?.length ?? 0})`);
							resources = idleResult.resources;
							output = idleResult.output;
						}
						break;
					}
				}
				if (this._state === OutputMonitorState.Idle || this._state === OutputMonitorState.Cancelled || this._state === OutputMonitorState.Timeout) {
					break;
				}
			}

			if (token.isCancellationRequested) {
				this._state = OutputMonitorState.Cancelled;
			}
		} finally {
			this._logService.trace(`OutputMonitor: Monitoring finished (state=${OutputMonitorState[this._state]}, duration=${Date.now() - pollStartTime}ms)`);
			this._pollingResult = {
				state: this._state,
				output: output ?? this._execution.getOutput(),
				pollDurationMs: Date.now() - pollStartTime,
				resources
			};
			this._userInputListener.clear();
			this._fireFinishedOnce();
		}
	}

	continueMonitoringAsync(token: CancellationToken): void {
		this._asyncMode = true;
		const currentMonitoringCts = this._currentMonitoringCts;
		currentMonitoringCts?.cancel();
		currentMonitoringCts?.dispose();
		this._currentMonitoringCts = new CancellationTokenSource(token);
		this._state = OutputMonitorState.PollingForIdle;
		this._startMonitoring(this._command, this._invocationContext, this._currentMonitoringCts.token);
	}

	private _waitForNewData(token: CancellationToken): Promise<void> {
		return new Promise<void>(resolve => {
			if (token.isCancellationRequested) {
				resolve();
				return;
			}
			const cleanup = () => {
				dataListener.dispose();
				tokenListener.dispose();
				disposedListener.dispose();
			};
			const dataListener = this._execution.instance.onData(() => {
				cleanup();
				resolve();
			});
			const tokenListener = token.onCancellationRequested(() => {
				cleanup();
				resolve();
			});
			const disposedListener = this._execution.instance.onDisposed(() => {
				cleanup();
				resolve();
			});
		});
	}


	private async _handleIdleState(token: CancellationToken): Promise<{ resources?: ILinkLocation[]; shouldContinuePolling: boolean; output?: string }> {
		const output = this._execution.getOutput();

		const outputTail = output.slice(-1000);
		const outputLastLine = getLastLine(outputTail);
		this._logService.trace(`OutputMonitor: Idle output summary: len=${output.length}, lastLine=${this._formatLastLineForLog(outputTail)}`);

		if (detectsNonInteractiveHelpPattern(outputLastLine)) {
			this._logService.trace('OutputMonitor: Idle -> non-interactive help pattern detected, stopping');
			return { shouldContinuePolling: false, output };
		}

		const isTask = this._execution.task !== undefined;
		if (isTask && detectsVSCodeTaskFinishMessage(outputTail)) {
			this._logService.trace('OutputMonitor: Idle -> VS Code task finish message detected, stopping');
			return { shouldContinuePolling: false, output };
		}

		if (!isTask && detectsGenericPressAnyKeyPattern(outputTail)) {
			this._logService.trace('OutputMonitor: Idle -> generic "press any key" detected, signaling agent');
			this._onDidDetectInputNeeded.fire();
			this._cleanupIdleInputListener();
			return { shouldContinuePolling: false, output };
		}

		if (this._userInputtedSinceIdleDetected) {
			this._logService.trace('OutputMonitor: User input detected since idle; skipping prompt and continuing polling');
			this._cleanupIdleInputListener();
			return { shouldContinuePolling: true };
		}

		let shouldFireInputNeeded = detectsInputRequiredPattern(outputLastLine);
		if (!shouldFireInputNeeded && detectsLikelyInputRequiredPattern(outputLastLine)) {
			const isActive = this._execution.isActive ? await this._execution.isActive() : undefined;
			if (isActive === true) {
				shouldFireInputNeeded = true;
			}
		}

		if (shouldFireInputNeeded && this._userInputtedSinceIdleDetected) {
			this._logService.trace('OutputMonitor: User input detected during isActive await; skipping prompt and continuing polling');
			this._cleanupIdleInputListener();
			return { shouldContinuePolling: true };
		}

		if (this._asyncMode) {
			if (shouldFireInputNeeded) {
				if (this._isSensitivePrompt(outputLastLine)) {
					this._logService.trace('OutputMonitor: Async mode - sensitive input prompt detected, signaling sensitive UI');
					this._onDidDetectSensitiveInputNeeded.fire();
				} else {
					this._logService.trace('OutputMonitor: Async mode - input-required pattern detected, signaling agent');
					this._onDidDetectInputNeeded.fire();
				}
			}
			this._cleanupIdleInputListener();
			return { shouldContinuePolling: false, output };
		}

		if (shouldFireInputNeeded) {
			if (this._isSensitivePrompt(outputLastLine)) {
				this._logService.trace('OutputMonitor: Sensitive input prompt detected, signaling sensitive UI');
				this._onDidDetectSensitiveInputNeeded.fire();
			} else {
				this._logService.trace('OutputMonitor: Input-required pattern detected, signaling agent');
				this._onDidDetectInputNeeded.fire();
			}
			this._cleanupIdleInputListener();
			return { shouldContinuePolling: false, output };
		}

		this._cleanupIdleInputListener();

		const custom = await this._pollFn?.(this._execution, token, this._taskService);
		this._logService.trace(`OutputMonitor: Custom poller result: ${custom ? 'provided' : 'none'}`);
		const resources = custom?.resources;
		return { resources, shouldContinuePolling: false, output: custom?.output ?? output };
	}

	private async _handleTimeoutState(_command: string, _invocationContext: IToolInvocationContext | undefined, _extended: boolean, _token: CancellationToken): Promise<boolean> {
		if (_extended) {
			this._logService.info('OutputMonitor: Extended polling timeout reached after 2 minutes, signaling potential input needed');
			this._onDidDetectInputNeeded.fire();
			this._state = OutputMonitorState.Cancelled;
			return false;
		}
		return true;
	}

	private async _waitForIdle(
		execution: IExecution,
		extendedPolling: boolean,
		token: CancellationToken,
	): Promise<OutputMonitorState> {

		const maxWaitMs = extendedPolling ? PollingConsts.ExtendedPollingMaxDuration : PollingConsts.FirstPollingMaxDuration;
		const maxInterval = PollingConsts.MaxPollingIntervalDuration;
		let currentInterval = PollingConsts.MinPollingDuration;
		let waited = 0;
		let consecutiveIdleEvents = 0;
		let hasReceivedData = false;
		const onDataDisposable = execution.instance.onData((_data) => {
			hasReceivedData = true;
		});

		try {
			while (!token.isCancellationRequested && waited < maxWaitMs) {
				const waitTime = Math.min(currentInterval, maxWaitMs - waited);
				try {
					await timeout(waitTime, token);
				} catch (err) {
					if (token.isCancellationRequested) {
						return OutputMonitorState.Cancelled;
					}
					throw err;
				}
				waited += waitTime;
				currentInterval = Math.min(currentInterval * 2, maxInterval);
				const currentOutput = execution.getOutput();
				const currentTail = currentOutput.slice(-1000);
				const currentLastLine = getLastLine(currentTail);

				if (detectsNonInteractiveHelpPattern(currentLastLine)) {
					this._logService.trace(`OutputMonitor: waitForIdle -> non-interactive help detected (waited=${waited}ms)`);
					this._state = OutputMonitorState.Idle;
					this._setupIdleInputListener();
					return this._state;
				}

				const promptResult = detectsHighConfidenceInputPattern(currentLastLine);
				if (promptResult) {
					this._logService.trace(`OutputMonitor: waitForIdle -> high-confidence input pattern detected (waited=${waited}ms, lastLine=${this._formatLastLineForLog(currentTail)})`);
					this._state = OutputMonitorState.Idle;
					this._setupIdleInputListener();
					return this._state;
				}

				if (hasReceivedData) {
					consecutiveIdleEvents = 0;
					hasReceivedData = false;
				} else {
					consecutiveIdleEvents++;
				}

				const recentlyIdle = consecutiveIdleEvents >= PollingConsts.MinIdleEvents;
				const isActive = execution.isActive ? await execution.isActive() : undefined;
				this._logService.trace(`OutputMonitor: waitForIdle check: waited=${waited}ms, recentlyIdle=${recentlyIdle}, isActive=${isActive}`);
				if (recentlyIdle && isActive !== true) {
					this._logService.trace(`OutputMonitor: waitForIdle -> recentlyIdle && !active (waited=${waited}ms, lastLine=${this._formatLastLineForLog(currentTail)})`);
					this._state = OutputMonitorState.Idle;
					this._setupIdleInputListener();
					return this._state;
				}

				if (recentlyIdle && isActive === true && detectsLikelyInputRequiredPattern(currentLastLine)) {
					this._logService.trace(`OutputMonitor: waitForIdle -> broad input pattern detected while active+idle (waited=${waited}ms, lastLine=${this._formatLastLineForLog(currentTail)})`);
					this._state = OutputMonitorState.Idle;
					this._setupIdleInputListener();
					return this._state;
				}
			}
		} finally {
			onDataDisposable.dispose();
		}

		if (token.isCancellationRequested) {
			return OutputMonitorState.Cancelled;
		}

		return OutputMonitorState.Timeout;
	}

	private _setupIdleInputListener(): void {
		if (this._store.isDisposed) {
			return;
		}
		this._userInputtedSinceIdleDetected = false;
		this._logService.trace('OutputMonitor: Setting up idle input listener');

		this._userInputListener.value = this._execution.instance.onDidInputData(() => {
			this._userInputtedSinceIdleDetected = true;
			this._logService.trace('OutputMonitor: Detected user terminal input while idle');
		});
	}

	private _cleanupIdleInputListener(): void {
		this._userInputtedSinceIdleDetected = false;
		this._userInputListener.clear();
	}

	private _isSensitivePrompt(prompt: string): boolean {
		if (isCanonicalSudoSPrompt(this._command, prompt)) {
			return false;
		}

		return detectsSensitiveInputPrompt(prompt);
	}
}

function isCanonicalSudoSPrompt(command: string, prompt: string): boolean {
	return /(?:^|\s)sudo\s+-S(?:\s|$)/.test(command) && /^\[sudo\]\s+password for .+:\s*$/i.test(prompt);
}

export function detectsSensitiveInputPrompt(cursorLine: string): boolean {
	return /(password|passphrase|token|api\s*key|secret|verification code|otp\b|one[\s-]?time (?:code|password)|2fa|mfa|pin\s*(?:code|number)?[: ]?\s*$|authentication code)/i.test(cursorLine);
}

export function matchTerminalPromptOption(options: readonly string[], suggestedOption: string): { option: string | undefined; index: number } {
	const normalize = (value: string) => value.replace(/['"`]/g, '').trim().replace(/[.,:;]+$/, '');

	const normalizedSuggestion = normalize(suggestedOption);
	if (!normalizedSuggestion) {
		return { option: undefined, index: -1 };
	}

	const candidates: string[] = [normalizedSuggestion];
	const firstWhitespaceToken = normalizedSuggestion.split(/\s+/)[0];
	if (firstWhitespaceToken && firstWhitespaceToken !== normalizedSuggestion) {
		candidates.push(firstWhitespaceToken);
	}
	const firstAlphaNum = normalizedSuggestion.match(/[A-Za-z0-9]+/);
	if (firstAlphaNum?.[0] && firstAlphaNum[0] !== normalizedSuggestion && firstAlphaNum[0] !== firstWhitespaceToken) {
		candidates.push(firstAlphaNum[0]);
	}

	for (const candidate of candidates) {
		const exactIndex = options.findIndex(opt => normalize(opt) === candidate);
		if (exactIndex !== -1) {
			return { option: options[exactIndex], index: exactIndex };
		}
		const lowerCandidate = candidate.toLowerCase();
		const ciIndex = options.findIndex(opt => normalize(opt).toLowerCase() === lowerCandidate);
		if (ciIndex !== -1) {
			return { option: options[ciIndex], index: ciIndex };
		}
	}

	return { option: undefined, index: -1 };
}

export function detectsHighConfidenceInputPattern(cursorLine: string): boolean {
	return [
		/\s*(?:\[[^\]]\][^\[]*)+(?:\(default is\s+"[^"]+"\):)?\s+$/,
		/(?:\(|\[)\s*(?:y(?:es)?\s*\/\s*n(?:o)?|n(?:o)?\s*\/\s*y(?:es)?)\s*(?:\]|\))\s+$/i,
		/[?:]\s*(?:\(|\[)?\s*y(?:es)?\s*\/\s*n(?:o)?\s*(?:\]|\))?\s+$/i,
		/\(y\) +$/i,
		/:\s+\([^)]*\) +$/,
		/\(END\)$/,
		/password(?: for [^:]+)?:\s*$/i,
		/press a(?:ny)? key/i,
		/^(?:\s|\x1b\[[0-9;]*m)*\?.*[›❯▸▶]\s*$/,
	].some(e => e.test(cursorLine));
}

export function detectsInputRequiredPattern(cursorLine: string): boolean {
	return detectsHighConfidenceInputPattern(cursorLine);
}

export function detectsLikelyInputRequiredPattern(cursorLine: string): boolean {
	if (detectsHighConfidenceInputPattern(cursorLine)) {
		return true;
	}
	return [
		/: +$/,
		/\? *(?:\([a-z\s]+\))? +$/i,
	].some(e => e.test(cursorLine));
}

export function detectsNonInteractiveHelpPattern(cursorLine: string): boolean {
	return [
		/press [h?]\s*(?:\+\s*enter)?\s*to (?:show|open|display|get|see)\s*(?:available )?(?:help|commands|options)/i,
		/press h\s*(?:or\s*\?)?\s*(?:\+\s*enter)?\s*for (?:help|commands|options)/i,
		/press \?\s*(?:\+\s*enter)?\s*(?:to|for)?\s*(?:help|commands|options|list)/i,
		/type\s*[h?]\s*(?:\+\s*enter)?\s*(?:for|to see|to show)\s*(?:help|commands|options)/i,
		/hit\s*[h?]\s*(?:\+\s*enter)?\s*(?:for|to see|to show)\s*(?:help|commands|options)/i,
		/press o\s*(?:\+\s*enter)?\s*(?:to|for)?\s*(?:open|launch)(?:\s*(?:the )?(?:app|application|browser)|\s+in\s+(?:the\s+)?browser)?/i,
		/press r\s*(?:\+\s*enter)?\s*(?:to|for)?\s*(?:restart|reload|refresh)(?:\s*(?:the )?(?:server|dev server|service))?/i,
		/press q\s*(?:\+\s*enter)?\s*(?:to|for)?\s*(?:quit|exit|stop)(?:\s*(?:the )?(?:server|app|process))?/i,
		/press u\s*(?:\+\s*enter)?\s*(?:to|for)?\s*(?:show|print|display)\s*(?:the )?(?:server )?urls?/i
	].some(e => e.test(cursorLine));
}

const taskFinishMessages = [
	localize('closeTerminal', "Terminal will be reused by tasks, press any key to close it."),
	localize('reuseTerminal', "Terminal will be reused by tasks, press any key to close it."),
	localize('exitCode.closeTerminal', "Press any key to close the terminal."),
	localize('exitCode.reuseTerminal', "Press any key to close the terminal."),
	localize('reuseTerminal.pressClose', "The terminal will be reused by tasks. Press any key to close."),
];

const normalizedTaskFinishMessages = taskFinishMessages.map(msg =>
	msg.replace(/[\s.,:;!?"'`()[\]{}<>\-_/\\]+/g, '').toLowerCase()
);

export function detectsVSCodeTaskFinishMessage(cursorLine: string): boolean {
	const compact = cursorLine.replace(/[\s.,:;!?"'`()[\]{}<>\-_/\\]+/g, '').toLowerCase();
	return normalizedTaskFinishMessages.some(msg => compact.includes(msg));
}

export function detectsGenericPressAnyKeyPattern(cursorLine: string): boolean {
	if (detectsVSCodeTaskFinishMessage(cursorLine)) {
		return false;
	}
	return /press a(?:ny)? key/i.test(cursorLine);
}
