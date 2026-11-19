/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { isNumber } from '../../../../../../base/common/types.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { isCI, isMacintosh } from '../../../../../../base/common/platform.js';
import type { ICommandDetectionCapability } from '../../../../../../platform/terminal/common/capabilities/capabilities.js';
import { ITerminalLogService, type ITerminalLaunchError } from '../../../../../../platform/terminal/common/terminal.js';
import type { ITerminalInstance } from '../../../../terminal/browser/terminal.js';
import { trackIdleOnPrompt, waitForIdle, type ITerminalExecuteStrategy, type ITerminalExecuteStrategyResult } from './executeStrategy.js';
import type { IMarker as IXtermMarker } from '@xterm/xterm';
import { createAltBufferPromise, setupRecreatingStartMarker, stripCommandEchoAndPrompt } from './strategyHelpers.js';
import { TerminalChatAgentToolsSettingId } from '../../common/terminalChatAgentToolsConfiguration.js';
import { isMultilineCommand } from '../runInTerminalHelpers.js';

function isTerminalLaunchError(value: unknown): value is ITerminalLaunchError {
	return typeof value === 'object' && value !== null && 'message' in value;
}

function formatExitCodeOrError(exitCodeOrError: number | ITerminalLaunchError | undefined): string {
	if (isTerminalLaunchError(exitCodeOrError)) {
		return `launch error: ${exitCodeOrError.message}${exitCodeOrError.code !== undefined ? `, code=${exitCodeOrError.code}` : ''}`;
	}
	return `code=${exitCodeOrError}`;
}

function extractExitCode(exitCodeOrError: number | ITerminalLaunchError | undefined): number | undefined {
	if (isNumber(exitCodeOrError)) {
		return exitCodeOrError;
	}
	if (isTerminalLaunchError(exitCodeOrError)) {
		return exitCodeOrError.code;
	}
	return undefined;
}

export class RichExecuteStrategy extends Disposable implements ITerminalExecuteStrategy {
	readonly type = 'rich';
	private readonly _startMarker = this._register(new MutableDisposable<IXtermMarker>());

	private readonly _onDidCreateStartMarker = this._register(new Emitter<IXtermMarker | undefined>);
	public onDidCreateStartMarker: Event<IXtermMarker | undefined> = this._onDidCreateStartMarker.event;

	private readonly _executionStores = this._register(new DisposableStore());

	constructor(
		private readonly _instance: ITerminalInstance,
		private readonly _commandDetection: ICommandDetectionCapability,
		private readonly _isSyncMode: boolean,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
	) {
		super();
	}

	async execute(commandLine: string, token: CancellationToken, commandId?: string, commandLineForMetadata?: string): Promise<ITerminalExecuteStrategyResult> {
		const store = new DisposableStore();
		this._executionStores.add(store);
		try {
			if (this._instance.isDisposed) {
				this._log('Terminal already disposed at strategy entry');
				throw new Error('The terminal was closed');
			}
			if (this._instance.exitCode !== undefined) {
				this._log(`Terminal pty already exited at strategy entry (code=${this._instance.exitCode})`);
				return {
					output: undefined,
					exitCode: this._instance.exitCode,
					additionalInformation: `Command exited with code ${this._instance.exitCode}`,
				};
			}

			const idlePollInterval = this._configurationService.getValue<number>(TerminalChatAgentToolsSettingId.IdlePollInterval) ?? 1000;

			const staleMarker = this._commandDetection.executingCommandObject?.marker;
			const onCommandFinishedFiltered = staleMarker
				? Event.filter(this._commandDetection.onCommandFinished, e => e.marker !== staleMarker, store)
				: this._commandDetection.onCommandFinished;

			const onDone = Promise.race([
				Event.toPromise(onCommandFinishedFiltered, store).then(e => {
					this._log('onDone via end event');
					return {
						'type': 'success',
						command: e
					} as const;
				}),
				Event.toPromise(token.onCancellationRequested as Event<undefined>, store).then(() => {
					this._log('onDone via cancellation');
				}),
				Event.toPromise(this._instance.onDisposed, store).then(() => {
					this._log('onDone via terminal disposal');
					return { type: 'disposal' } as const;
				}),
				Event.toPromise(this._instance.onExit, store).then((exitCodeOrError) => {
					this._log(`onDone via process exit (${formatExitCodeOrError(exitCodeOrError)})`);
					return { type: 'processExit', exitCodeOrError } as const;
				}),
				...(this._isSyncMode ? [
					trackIdleOnPrompt(this._instance, idlePollInterval, store, idlePollInterval, this._logService, { disableFallbacks: true }).then(() => {
						this._log('onDone via idle prompt');
					}),
				] : []),
			]);

			this._log('Waiting for xterm');
			const xterm = await this._instance.xtermReadyPromise;
			if (!xterm) {
				throw new Error('Xterm is not available');
			}
			const alternateBufferPromise = createAltBufferPromise(xterm, store, this._log.bind(this));

			const markerRecreation = setupRecreatingStartMarker(
				xterm,
				this._startMarker,
				m => this._onDidCreateStartMarker.fire(m),
				store,
				this._log.bind(this)
			);

			const activeBuffer = (xterm as any)?.raw?.buffer?.active;
			const lineIndex = activeBuffer ? (activeBuffer.baseY + activeBuffer.cursorY) : 0;
			const currentCursorLine = activeBuffer ? (activeBuffer.getLine(lineIndex)?.translateToString(true) ?? '') : '';
			if (/^\s*>>/.test(currentCursorLine) || />>\s*$/.test(currentCursorLine) || /^\s*\.{3}/.test(currentCursorLine)) {
				this._log('Terminal trapped in continuation prompt (>> ), sending SIGINT to reset');
				await this._instance.sendText('\x03', false);
				await waitForIdle(this._instance.onData, 150);
			}

			this._log(`Executing command line \`${commandLine}\``);
			markerRecreation.dispose();
			const forceBracketedPasteMode = isMacintosh || isMultilineCommand(commandLine);
			this._instance.runCommand(commandLine, true, commandId, forceBracketedPasteMode, commandLineForMetadata);

			this._log('Waiting for done event');
			const onDoneResult = await Promise.race([onDone, alternateBufferPromise.then(() => ({ type: 'alternateBuffer' } as const))]);
			if (onDoneResult && onDoneResult.type === 'disposal') {
				throw new Error('The terminal was closed');
			}
			if (onDoneResult && onDoneResult.type === 'alternateBuffer') {
				this._log('Detected alternate buffer entry, skipping output capture');
				return {
					output: undefined,
					exitCode: undefined,
					error: 'alternateBuffer',
					didEnterAltBuffer: true
				};
			}
			const finishedCommand = onDoneResult && onDoneResult.type === 'success' ? onDoneResult.command : undefined;

			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const endMarker = store.add(xterm.raw.registerMarker());

			let output: string | undefined;
			const additionalInformationLines: string[] = [];
			if (finishedCommand) {
				const commandOutput = finishedCommand?.getOutput();
				if (commandOutput !== undefined) {
					this._log('Fetched output via finished command');
					output = stripCommandEchoAndPrompt(commandOutput, commandLine, this._log.bind(this));
				}
			}
			if (output === undefined) {
				try {
					const startMarkerDisposed = this._startMarker.value?.line === -1;
					output = xterm.getContentsAsText(this._startMarker.value, endMarker);
					this._log('Fetched output via markers');

					if (output !== undefined) {
						output = stripCommandEchoAndPrompt(output, commandLine, this._log.bind(this));
					}

					if (startMarkerDisposed) {
						this._log('Start marker was disposed (output exceeded scrollback), output may be truncated from the beginning');
						additionalInformationLines.push('Output exceeded terminal scrollback; beginning of output was lost');
					}
				} catch {
					this._log('Failed to fetch output via markers');
					additionalInformationLines.push('Failed to retrieve command output');
				}
			}

			if (output !== undefined && output.trim().length === 0) {
				additionalInformationLines.push('Command produced no output');
			}

			let exitCode = finishedCommand?.exitCode;
			if (exitCode === undefined && onDoneResult && onDoneResult.type === 'processExit') {
				exitCode = extractExitCode(onDoneResult.exitCodeOrError);
			}
			if (isNumber(exitCode) && exitCode > 0) {
				additionalInformationLines.push(`Command exited with code ${exitCode}`);
			}

			return {
				output,
				additionalInformation: additionalInformationLines.length > 0 ? additionalInformationLines.join('\n') : undefined,
				exitCode,
			};
		} finally {
			this._executionStores.delete(store);
		}
	}

	private _log(message: string) {
		const msg = `RunInTerminalTool#Rich: ${message}`;
		if (isCI) {
			this._logService.info(msg);
		} else {
			this._logService.debug(msg);
		}
	}
}
