/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { ITerminalLogService } from '../../../../../../platform/terminal/common/terminal.js';
import { waitForIdle, waitForIdleWithPromptHeuristics, type ITerminalExecuteStrategy, type ITerminalExecuteStrategyResult } from './executeStrategy.js';
import type { IMarker as IXtermMarker } from '@xterm/xterm';
import { ITerminalInstance } from '../../../../terminal/browser/terminal.js';
import { createAltBufferPromise, setupRecreatingStartMarker, stripCommandEchoAndPrompt } from './strategyHelpers.js';
import { TerminalChatAgentToolsSettingId } from '../../common/terminalChatAgentToolsConfiguration.js';
import { isMacintosh } from '../../../../../../base/common/platform.js';
import { isMultilineCommand } from '../runInTerminalHelpers.js';

export class NoneExecuteStrategy extends Disposable implements ITerminalExecuteStrategy {
	readonly type = 'none';
	private readonly _startMarker = this._register(new MutableDisposable<IXtermMarker>());


	private readonly _onDidCreateStartMarker = this._register(new Emitter<IXtermMarker | undefined>);
	public onDidCreateStartMarker: Event<IXtermMarker | undefined> = this._onDidCreateStartMarker.event;

	constructor(
		private readonly _instance: ITerminalInstance,
		private readonly _hasReceivedUserInput: () => boolean,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITerminalLogService private readonly _logService: ITerminalLogService,
	) {
		super();
	}

	async execute(commandLine: string, token: CancellationToken, _commandId?: string, _commandLineForMetadata?: string): Promise<ITerminalExecuteStrategyResult> {
		const store = new DisposableStore();
		try {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			this._log('Waiting for xterm');
			const xterm = await this._instance.xtermReadyPromise;
			if (!xterm) {
				throw new Error('Xterm is not available');
			}
			const alternateBufferPromise = createAltBufferPromise(xterm, store, this._log.bind(this));

			const idlePollInterval = this._configurationService.getValue<number>(TerminalChatAgentToolsSettingId.IdlePollInterval) ?? 1000;

			this._log('Waiting for idle');
			await waitForIdle(this._instance.onData, idlePollInterval);
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			const markerRecreation = setupRecreatingStartMarker(
				xterm,
				this._startMarker,
				m => this._onDidCreateStartMarker.fire(m),
				store,
				this._log.bind(this)
			);

			if (this._hasReceivedUserInput()) {
				this._log('Sending Ctrl+U to clear any pending input before sending command');
				await this._instance.sendText('\x15', false);
				await waitForIdle(this._instance.onData, 100);
			}

			this._log(`Executing command line \`${commandLine}\``);
			markerRecreation.dispose();
			const startLine = this._startMarker.value?.line;
			const forceBracketedPasteMode = isMacintosh || isMultilineCommand(commandLine);
			this._instance.sendText(commandLine, true, forceBracketedPasteMode);

			if (startLine !== undefined) {
				this._log('Waiting for cursor to move past start line');
				const cursorMovedPromise = new Promise<void>(resolve => {
					const check = () => {
						const buffer = xterm.raw.buffer.active;
						const cursorLine = buffer.baseY + buffer.cursorY;
						if (cursorLine > startLine) {
							resolve();
						}
					};
					const listener = this._instance.onData(() => check());
					store.add(listener);
					check();
				});

				const cursorMoveTimeout = new Promise<'timeout'>(resolve => {
					const handle = setTimeout(() => resolve('timeout'), 1000);
					store.add({ dispose: () => clearTimeout(handle) });
				});

				const raceResult = await Promise.race([cursorMovedPromise, cursorMoveTimeout]);
				if (raceResult === 'timeout') {
					this._log('Cursor did not move past start line before timeout, proceeding with idle detection');
				}
			}


			this._log('Waiting for idle with prompt heuristics');
			const promptResultOrAltBuffer = await Promise.race([
				waitForIdleWithPromptHeuristics(this._instance.onData, this._instance, idlePollInterval, idlePollInterval * 10),
				alternateBufferPromise.then(() => 'alternateBuffer' as const)
			]);
			if (promptResultOrAltBuffer === 'alternateBuffer') {
				this._log('Detected alternate buffer entry, skipping output capture');
				return {
					output: undefined,
					additionalInformation: undefined,
					exitCode: undefined,
					error: 'alternateBuffer',
					didEnterAltBuffer: true,
				};
			}
			const promptResult = promptResultOrAltBuffer;
			this._log(`Prompt detection result: ${promptResult.detected ? 'detected' : 'not detected'} - ${promptResult.reason}`);

			if (token.isCancellationRequested) {
				throw new CancellationError();
			}
			const endMarker = store.add(xterm.raw.registerMarker());

			let output: string | undefined;
			const additionalInformationLines: string[] = [];
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

			if (output !== undefined && output.trim().length === 0) {
				additionalInformationLines.push('Command produced no output');
			}

			return {
				output,
				additionalInformation: additionalInformationLines.length > 0 ? additionalInformationLines.join('\n') : undefined,
				exitCode: undefined,
			};
		} finally {
			store.dispose();
		}
	}

	private _log(message: string) {
		this._logService.debug(`RunInTerminalTool#None: ${message}`);
	}
}
