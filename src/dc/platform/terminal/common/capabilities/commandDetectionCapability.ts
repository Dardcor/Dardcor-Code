/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { debounce } from '../../../../base/common/decorators.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, MandatoryMutableDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../log/common/log.js';
import { isString } from '../../../../base/common/types.js';
import { CommandInvalidationReason, ICommandDetectionCapability, ICommandInvalidationRequest, IHandleCommandOptions, ISerializedCommandDetectionCapability, ISerializedTerminalCommand, ITerminalCommand, TerminalCapability } from './capabilities.js';
import { ITerminalOutputMatcher } from '../terminal.js';
import { ICurrentPartialCommand, isFullTerminalCommand, PartialTerminalCommand, TerminalCommand } from './commandDetection/terminalCommand.js';
import { PromptInputModel, type IPromptInputModel } from './commandDetection/promptInputModel.js';
import type { IBuffer, IDisposable, IMarker, Terminal } from '@xterm/headless';

interface ITerminalDimensions {
	cols: number;
	rows: number;
}

export class CommandDetectionCapability extends Disposable implements ICommandDetectionCapability {
	readonly type = TerminalCapability.CommandDetection;

	private readonly _promptInputModel: PromptInputModel;
	get promptInputModel(): IPromptInputModel { return this._promptInputModel; }

	protected _commands: TerminalCommand[] = [];
	private _cwd: string | undefined;
	private _promptTerminator: string | undefined;
	private _currentCommand: PartialTerminalCommand;
	private _commandMarkers: IMarker[] = [];
	private _dimensions: ITerminalDimensions;
	private __isCommandStorageDisabled: boolean = false;
	private _handleCommandStartOptions?: IHandleCommandOptions;
	private _hasRichCommandDetection: boolean = false;
	get hasRichCommandDetection() { return this._hasRichCommandDetection; }
	private _nextCommandId: { command: string; commandId: string | undefined } | undefined;
	private _isCurrentCommandInterrupted = false;

	private _ptyHeuristicsHooks: ICommandDetectionHeuristicsHooks;
	private readonly _ptyHeuristics: MandatoryMutableDisposable<IPtyHeuristics>;

	get commands(): readonly TerminalCommand[] { return this._commands; }
	get executingCommand(): string | undefined { return this._currentCommand.command; }
	get executingCommandObject(): ITerminalCommand | undefined {
		if (this._currentCommand.commandStartMarker) {
			return this._currentCommand.promoteToFullCommand(this._cwd, undefined, this._handleCommandStartOptions?.ignoreCommandLine ?? false, undefined);
		}
		return undefined;
	}
	get executingCommandConfidence(): 'low' | 'medium' | 'high' | undefined {
		const casted = this._currentCommand as PartialTerminalCommand | ITerminalCommand;
		return isFullTerminalCommand(casted) ? casted.commandLineConfidence : undefined;
	}
	get currentCommand(): ICurrentPartialCommand {
		return this._currentCommand;
	}
	get cwd(): string | undefined { return this._cwd; }
	get promptTerminator(): string | undefined { return this._promptTerminator; }

	private readonly _onCommandStarted = this._register(new Emitter<ITerminalCommand>());
	readonly onCommandStarted = this._onCommandStarted.event;
	private readonly _onCommandStartChanged = this._register(new Emitter<void>());
	readonly onCommandStartChanged = this._onCommandStartChanged.event;
	private readonly _onBeforeCommandFinished = this._register(new Emitter<ITerminalCommand>());
	readonly onBeforeCommandFinished = this._onBeforeCommandFinished.event;
	private readonly _onCommandFinished = this._register(new Emitter<ITerminalCommand>());
	readonly onCommandFinished = this._onCommandFinished.event;
	private readonly _onCommandExecuted = this._register(new Emitter<ITerminalCommand>());
	readonly onCommandExecuted = this._onCommandExecuted.event;
	private readonly _onCommandInvalidated = this._register(new Emitter<ITerminalCommand[]>());
	readonly onCommandInvalidated = this._onCommandInvalidated.event;
	private readonly _onCurrentCommandInvalidated = this._register(new Emitter<ICommandInvalidationRequest>());
	readonly onCurrentCommandInvalidated = this._onCurrentCommandInvalidated.event;
	private readonly _onSetRichCommandDetection = this._register(new Emitter<boolean>());
	readonly onSetRichCommandDetection = this._onSetRichCommandDetection.event;

	constructor(
		private readonly _terminal: Terminal,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._currentCommand = new PartialTerminalCommand(this._terminal);
		this._promptInputModel = this._register(new PromptInputModel(this._terminal, this.onCommandStarted, this.onCommandStartChanged, this.onCommandExecuted, this.onCommandFinished, this._logService));
		this._register(this._promptInputModel.onDidInterrupt(() => this._isCurrentCommandInterrupted = true));

		this._register(this.onCommandExecuted(command => {
			if (command.commandLineConfidence !== 'high') {
				const typedCommand = (command as ITerminalCommand | PartialTerminalCommand);
				command.command = typedCommand.extractCommandLine();
				command.commandLineConfidence = 'low';

				if (isFullTerminalCommand(typedCommand)) {
					if (
						typedCommand.promptStartMarker && typedCommand.marker && typedCommand.executedMarker &&
						command.command.indexOf('\n') === -1 &&
						typedCommand.startX !== undefined && typedCommand.startX > 0
					) {
						command.commandLineConfidence = 'medium';
					}
				}
				else {
					if (
						typedCommand.promptStartMarker && typedCommand.commandStartMarker && typedCommand.commandExecutedMarker &&
						command.command.indexOf('\n') === -1 &&
						typedCommand.commandStartX !== undefined && typedCommand.commandStartX > 0
					) {
						command.commandLineConfidence = 'medium';
					}
				}
			}
		}));

		this._register(this._terminal.parser.registerCsiHandler({ final: 'J' }, params => {
			if (params.length >= 1 && params[0] === 2) {
				if (!this._terminal.options.scrollOnEraseInDisplay) {
					this._clearCommandsInViewport();
				}
				this._currentCommand.wasCleared = true;
			}
			return false;
		}));

		const that = this;
		this._ptyHeuristicsHooks = new class implements ICommandDetectionHeuristicsHooks {
			get onCurrentCommandInvalidatedEmitter() { return that._onCurrentCommandInvalidated; }
			get onCommandStartedEmitter() { return that._onCommandStarted; }
			get onCommandExecutedEmitter() { return that._onCommandExecuted; }
			get dimensions() { return that._dimensions; }
			get isCommandStorageDisabled() { return that.__isCommandStorageDisabled; }
			get commandMarkers() { return that._commandMarkers; }
			set commandMarkers(value) { that._commandMarkers = value; }
			get clearCommandsInViewport() { return that._clearCommandsInViewport.bind(that); }
		};
		this._ptyHeuristics = this._register(new MandatoryMutableDisposable(new UnixPtyHeuristics(this._terminal, this, this._ptyHeuristicsHooks, this._logService)));

		this._dimensions = {
			cols: this._terminal.cols,
			rows: this._terminal.rows
		};
		this._register(this._terminal.onResize(e => this._handleResize(e)));
		this._register(this._terminal.onCursorMove(() => this._handleCursorMove()));
	}

	private _handleResize(e: { cols: number; rows: number }) {
		this._ptyHeuristics.value.preHandleResize?.(e);
		this._dimensions.cols = e.cols;
		this._dimensions.rows = e.rows;
	}

	@debounce(500)
	private _handleCursorMove() {
		if (this._store.isDisposed) {
			return;
		}
		if (this._terminal.buffer.active === this._terminal.buffer.normal && this._currentCommand.commandStartMarker) {
			if (this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY < this._currentCommand.commandStartMarker.line) {
				this._clearCommandsInViewport();
				this._currentCommand.isInvalid = true;
				this._onCurrentCommandInvalidated.fire({ reason: CommandInvalidationReason.Windows });
			}
		}
	}

	private _clearCommandsInViewport(): void {
		let count = 0;
		for (let i = this._commands.length - 1; i >= 0; i--) {
			const line = this._commands[i].marker?.line;
			if (line && line < this._terminal.buffer.active.baseY) {
				break;
			}
			count++;
		}
		if (count > 0) {
			this._onCommandInvalidated.fire(this._commands.splice(this._commands.length - count, count));
		}
	}

	setContinuationPrompt(value: string): void {
		this._promptInputModel.setContinuationPrompt(value);
	}

	setPromptTerminator(promptTerminator: string, lastPromptLine: string) {
		this._logService.debug('CommandDetectionCapability#setPromptTerminator', promptTerminator);
		this._promptTerminator = promptTerminator;
		this._promptInputModel.setLastPromptLine(lastPromptLine);
	}

	setCwd(value: string) {
		this._cwd = value;
	}

	setIsWindowsPty(value: boolean) {
		if (value && !(this._ptyHeuristics.value instanceof WindowsPtyHeuristics)) {
			const that = this;
			this._ptyHeuristics.value = new WindowsPtyHeuristics(
				this._terminal,
				this,
				new class {
					get onCurrentCommandInvalidatedEmitter() { return that._onCurrentCommandInvalidated; }
					get onCommandStartedEmitter() { return that._onCommandStarted; }
					get onCommandExecutedEmitter() { return that._onCommandExecuted; }
					get dimensions() { return that._dimensions; }
					get isCommandStorageDisabled() { return that.__isCommandStorageDisabled; }
					get commandMarkers() { return that._commandMarkers; }
					set commandMarkers(value) { that._commandMarkers = value; }
					get clearCommandsInViewport() { return that._clearCommandsInViewport.bind(that); }
				},
				this._logService
			);
		} else if (!value && !(this._ptyHeuristics.value instanceof UnixPtyHeuristics)) {
			this._ptyHeuristics.value = new UnixPtyHeuristics(this._terminal, this, this._ptyHeuristicsHooks, this._logService);
		}
	}

	setHasRichCommandDetection(value: boolean): void {
		this._hasRichCommandDetection = value;
		this._onSetRichCommandDetection.fire(value);
	}

	setIsCommandStorageDisabled(): void {
		this.__isCommandStorageDisabled = true;
	}

	getCommandForLine(line: number): ITerminalCommand | ICurrentPartialCommand | undefined {
		if (this._currentCommand.promptStartMarker && line >= this._currentCommand.promptStartMarker?.line) {
			return this._currentCommand;
		}

		if (this._commands.length === 0) {
			return undefined;
		}

		if ((this._commands[0].promptStartMarker ?? this._commands[0].marker!).line > line) {
			return undefined;
		}

		for (let i = this.commands.length - 1; i >= 0; i--) {
			if ((this.commands[i].promptStartMarker ?? this.commands[i].marker!).line <= line) {
				return this.commands[i];
			}
		}

		return undefined;
	}

	getCwdForLine(line: number): string | undefined {
		if (this._currentCommand.promptStartMarker && line >= this._currentCommand.promptStartMarker?.line) {
			return this._cwd;
		}

		const command = this.getCommandForLine(line);
		if (command && isFullTerminalCommand(command)) {
			return command.cwd;
		}

		return undefined;
	}

	handlePromptStart(options?: IHandleCommandOptions): void {
		this._isCurrentCommandInterrupted = false;
		const lastCommand = this.commands.at(-1);
		if (
			lastCommand?.endMarker &&
			lastCommand?.executedMarker &&
			lastCommand.endMarker.line === lastCommand.executedMarker.line &&
			lastCommand.executedMarker.line < this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY
		) {
			this._logService.debug('CommandDetectionCapability#handlePromptStart adjusted commandFinished', `${lastCommand.endMarker.line} -> ${lastCommand.executedMarker.line + 1}`);
			lastCommand.endMarker = cloneMarker(this._terminal, lastCommand.executedMarker, 1);
		}

		this._currentCommand.promptStartMarker = (
			options?.marker ||
			(!this._currentCommand.wasCleared && lastCommand?.endMarker
				? cloneMarker(this._terminal, lastCommand.endMarker)
				: this._terminal.registerMarker(0))
		);
		this._currentCommand.wasCleared = false;
	}

	handleContinuationStart(): void {
		this._currentCommand.currentContinuationMarker = this._terminal.registerMarker(0);
		this._logService.debug('CommandDetectionCapability#handleContinuationStart', this._currentCommand.currentContinuationMarker);
	}

	handleContinuationEnd(): void {
		if (!this._currentCommand.currentContinuationMarker) {
			this._logService.warn('CommandDetectionCapability#handleContinuationEnd Received continuation end without start');
			return;
		}
		if (!this._currentCommand.continuations) {
			this._currentCommand.continuations = [];
		}
		this._currentCommand.continuations.push({
			marker: this._currentCommand.currentContinuationMarker,
			end: this._terminal.buffer.active.cursorX
		});
		this._currentCommand.currentContinuationMarker = undefined;
		this._logService.debug('CommandDetectionCapability#handleContinuationEnd', this._currentCommand.continuations[this._currentCommand.continuations.length - 1]);
	}

	handleRightPromptStart(): void {
		this._currentCommand.commandRightPromptStartX = this._terminal.buffer.active.cursorX;
		this._logService.debug('CommandDetectionCapability#handleRightPromptStart', this._currentCommand.commandRightPromptStartX);
	}

	handleRightPromptEnd(): void {
		this._currentCommand.commandRightPromptEndX = this._terminal.buffer.active.cursorX;
		this._logService.debug('CommandDetectionCapability#handleRightPromptEnd', this._currentCommand.commandRightPromptEndX);
	}

	handleCommandStart(options?: IHandleCommandOptions): void {
		this._handleCommandStartOptions = options;
		this._currentCommand.cwd = this._cwd;
		this._currentCommand.commandStartMarker = options?.marker || this._currentCommand.commandStartMarker;
		if (this._currentCommand.commandStartMarker?.line === this._terminal.buffer.active.cursorY) {
			this._currentCommand.commandStartX = this._terminal.buffer.active.cursorX;
			this._onCommandStartChanged.fire();
			this._logService.debug('CommandDetectionCapability#handleCommandStart', this._currentCommand.commandStartX, this._currentCommand.commandStartMarker?.line);
			return;
		}
		this._ptyHeuristics.value.handleCommandStart(options);
	}

	setNextCommandId(command: string, commandId: string): void {
		this._nextCommandId = { command, commandId };
	}

	handleCommandExecuted(options?: IHandleCommandOptions): void {
		this._ensureCurrentCommandId(this._currentCommand.command ?? this._currentCommand.extractCommandLine());
		this._ptyHeuristics.value.handleCommandExecuted(options);
		this._currentCommand.markExecutedTime();
	}

	handleCommandFinished(exitCode: number | undefined, options?: IHandleCommandOptions): void {
		if (!this._currentCommand.commandExecutedMarker) {
			this.handleCommandExecuted();
		}
		this._currentCommand.markFinishedTime();
		this._ptyHeuristics.value.preHandleCommandFinished?.();

		this._logService.debug('CommandDetectionCapability#handleCommandFinished', this._terminal.buffer.active.cursorX, options?.marker?.line, this._currentCommand.command, this._currentCommand);

		if (exitCode === undefined && !this._isCurrentCommandInterrupted) {
			const lastCommand = this.commands.length > 0 ? this.commands[this.commands.length - 1] : undefined;
			if (this._currentCommand.command && this._currentCommand.command.length > 0 && lastCommand?.command === this._currentCommand.command) {
				exitCode = lastCommand.exitCode;
			}
		}

		if (this._currentCommand.commandStartMarker === undefined || !this._terminal.buffer.active) {
			return;
		}

		this._currentCommand.commandFinishedMarker = options?.marker || this._terminal.registerMarker(0);

		this._ptyHeuristics.value.postHandleCommandFinished?.();

		const newCommand = this._currentCommand.promoteToFullCommand(this._cwd, exitCode, this._handleCommandStartOptions?.ignoreCommandLine ?? false, options?.markProperties);

		if (newCommand) {
			this._commands.push(newCommand);
			this._onBeforeCommandFinished.fire(newCommand);
			this._logService.debug('CommandDetectionCapability#onCommandFinished', newCommand);
			this._onCommandFinished.fire(newCommand);
		}
		this._currentCommand = new PartialTerminalCommand(this._terminal);
		this._handleCommandStartOptions = undefined;
	}

	private _ensureCurrentCommandId(_commandLine: string | undefined): void {
		if (this._nextCommandId?.commandId) {
			if (this._currentCommand.id !== this._nextCommandId.commandId) {
				this._currentCommand.id = this._nextCommandId.commandId;
			}
			this._nextCommandId = undefined;
		}
	}

	setCommandLine(commandLine: string, isTrusted: boolean) {
		this._logService.debug('CommandDetectionCapability#setCommandLine', commandLine, isTrusted);
		this._currentCommand.command = commandLine;
		this._currentCommand.commandLineConfidence = 'high';
		this._currentCommand.isTrusted = isTrusted;

		if (isTrusted) {
			this._promptInputModel.setConfidentCommandLine(commandLine);
		}
	}

	serialize(): ISerializedCommandDetectionCapability {
		const commands: ISerializedTerminalCommand[] = this.commands.map(e => e.serialize(this.__isCommandStorageDisabled));
		const partialCommand = this._currentCommand.serialize(this._cwd);
		if (partialCommand) {
			commands.push(partialCommand);
		}
		return {
			isWindowsPty: this._ptyHeuristics.value instanceof WindowsPtyHeuristics,
			hasRichCommandDetection: this._hasRichCommandDetection,
			commands,
			promptInputModel: this._promptInputModel.serialize(),
		};
	}

	deserialize(serialized: ISerializedCommandDetectionCapability): void {
		if (serialized.isWindowsPty) {
			this.setIsWindowsPty(serialized.isWindowsPty);
		}
		if (serialized.hasRichCommandDetection) {
			this.setHasRichCommandDetection(serialized.hasRichCommandDetection);
		}
		const buffer = this._terminal.buffer.normal;
		for (const e of serialized.commands) {
			if (!e.endLine) {
				const marker = e.startLine !== undefined ? this._terminal.registerMarker(e.startLine - (buffer.baseY + buffer.cursorY)) : undefined;
				if (!marker) {
					continue;
				}
				this._currentCommand.commandStartMarker = e.startLine !== undefined ? this._terminal.registerMarker(e.startLine - (buffer.baseY + buffer.cursorY)) : undefined;
				this._currentCommand.commandStartX = e.startX;
				this._currentCommand.promptStartMarker = e.promptStartLine !== undefined ? this._terminal.registerMarker(e.promptStartLine - (buffer.baseY + buffer.cursorY)) : undefined;
				this._cwd = e.cwd;
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				this._onCommandStarted.fire({ marker } as ITerminalCommand);
				continue;
			}

			const newCommand = TerminalCommand.deserialize(this._terminal, e, this.__isCommandStorageDisabled);
			if (!newCommand) {
				continue;
			}

			this._commands.push(newCommand);
			this._logService.debug('CommandDetectionCapability#onCommandFinished', newCommand);
			this._onCommandFinished.fire(newCommand);
		}
		if (serialized.promptInputModel) {
			this._promptInputModel.deserialize(serialized.promptInputModel);
		}
	}
}

interface ICommandDetectionHeuristicsHooks {
	readonly onCurrentCommandInvalidatedEmitter: Emitter<ICommandInvalidationRequest>;
	readonly onCommandStartedEmitter: Emitter<ITerminalCommand>;
	readonly onCommandExecutedEmitter: Emitter<ITerminalCommand>;
	readonly dimensions: ITerminalDimensions;
	readonly isCommandStorageDisabled: boolean;

	commandMarkers: IMarker[];

	clearCommandsInViewport(): void;
}

type IPtyHeuristics = (
	Partial<UnixPtyHeuristics> & Partial<WindowsPtyHeuristics> &
	(UnixPtyHeuristics | WindowsPtyHeuristics) &
	IDisposable
);

class UnixPtyHeuristics extends Disposable {
	constructor(
		private readonly _terminal: Terminal,
		private readonly _capability: CommandDetectionCapability,
		private readonly _hooks: ICommandDetectionHeuristicsHooks,
		private readonly _logService: ILogService
	) {
		super();
	}

	handleCommandStart(options?: IHandleCommandOptions) {
		const currentCommand = this._capability.currentCommand;
		currentCommand.commandStartX = this._terminal.buffer.active.cursorX;
		currentCommand.commandStartMarker = options?.marker || this._terminal.registerMarker(0);

		currentCommand.commandExecutedMarker?.dispose();
		currentCommand.commandExecutedMarker = undefined;
		currentCommand.commandExecutedX = undefined;
		for (const m of this._hooks.commandMarkers) {
			m.dispose();
		}
		this._hooks.commandMarkers.length = 0;

		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		this._hooks.onCommandStartedEmitter.fire({ marker: options?.marker || currentCommand.commandStartMarker, markProperties: options?.markProperties } as ITerminalCommand);
		this._logService.debug('CommandDetectionCapability#handleCommandStart', currentCommand.commandStartX, currentCommand.commandStartMarker?.line);
	}

	handleCommandExecuted(options?: IHandleCommandOptions) {
		const currentCommand = this._capability.currentCommand;
		currentCommand.commandExecutedMarker = options?.marker || this._terminal.registerMarker(0);
		currentCommand.commandExecutedX = this._terminal.buffer.active.cursorX;
		this._logService.debug('CommandDetectionCapability#handleCommandExecuted', currentCommand.commandExecutedX, currentCommand.commandExecutedMarker?.line);

		if (!currentCommand.commandStartMarker || !currentCommand.commandExecutedMarker || currentCommand.commandStartX === undefined) {
			return;
		}

		currentCommand.command = this._capability.promptInputModel.ghostTextIndex > -1 ? this._capability.promptInputModel.value.substring(0, this._capability.promptInputModel.ghostTextIndex) : this._capability.promptInputModel.value;
		this._hooks.onCommandExecutedEmitter.fire(currentCommand as ITerminalCommand);
	}
}

const enum AdjustCommandStartMarkerConstants {
	MaxCheckLineCount = 10,
	Interval = 20,
	MaximumPollCount = 10,
}

class WindowsPtyHeuristics extends Disposable {

	private readonly _onCursorMoveListener = this._register(new MutableDisposable());

	private _tryAdjustCommandStartMarkerScheduler?: RunOnceScheduler;
	private _tryAdjustCommandStartMarkerScannedLineCount: number = 0;
	private _tryAdjustCommandStartMarkerPollCount: number = 0;

	constructor(
		private readonly _terminal: Terminal,
		private readonly _capability: CommandDetectionCapability,
		private readonly _hooks: ICommandDetectionHeuristicsHooks,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._capability.onBeforeCommandFinished(command => {
			if (command.command.trim().toLowerCase() === 'clear' || command.command.trim().toLowerCase() === 'cls') {
				this._tryAdjustCommandStartMarkerScheduler?.cancel();
				this._tryAdjustCommandStartMarkerScheduler = undefined;
				this._hooks.clearCommandsInViewport();
				this._capability.currentCommand.isInvalid = true;
				this._hooks.onCurrentCommandInvalidatedEmitter.fire({ reason: CommandInvalidationReason.Windows });
			}
		}));
	}

	preHandleResize(e: { cols: number; rows: number }) {
		const baseY = this._terminal.buffer.active.baseY;
		const rowsDifference = e.rows - this._hooks.dimensions.rows;
		if (rowsDifference > 0) {
			this._waitForCursorMove().then(() => {
				const potentialShiftedLineCount = Math.min(rowsDifference, baseY);
				for (let i = this._capability.commands.length - 1; i >= 0; i--) {
					const command = this._capability.commands[i];
					if (!command.marker || command.marker.line < baseY || command.commandStartLineContent === undefined) {
						break;
					}
					const line = this._terminal.buffer.active.getLine(command.marker.line);
					if (!line || line.translateToString(true) === command.commandStartLineContent) {
						continue;
					}
					const shiftedY = command.marker.line - potentialShiftedLineCount;
					const shiftedLine = this._terminal.buffer.active.getLine(shiftedY);
					if (shiftedLine?.translateToString(true) !== command.commandStartLineContent) {
						continue;
					}
					interface IXtermWithCore extends Terminal {
						_core: {
							_bufferService: {
								buffer: {
									lines: {
										onDeleteEmitter: {
											fire(data: { index: number; amount: number }): void;
										};
									};
								};
							};
						};
					}
					(this._terminal as IXtermWithCore)._core._bufferService.buffer.lines.onDeleteEmitter.fire({
						index: this._terminal.buffer.active.baseY,
						amount: potentialShiftedLineCount
					});
				}
			});
		}
	}

	handleCommandStart() {
		this._capability.currentCommand.commandStartX = this._terminal.buffer.active.cursorX;

		this._hooks.commandMarkers.length = 0;

		const initialCommandStartMarker = this._capability.currentCommand.commandStartMarker = (
			this._capability.currentCommand.promptStartMarker
				? cloneMarker(this._terminal, this._capability.currentCommand.promptStartMarker)
				: this._terminal.registerMarker(0)
		)!;
		this._capability.currentCommand.commandStartX = 0;


		this._tryAdjustCommandStartMarkerScannedLineCount = 0;
		this._tryAdjustCommandStartMarkerPollCount = 0;
		this._tryAdjustCommandStartMarkerScheduler = new RunOnceScheduler(() => this._tryAdjustCommandStartMarker(initialCommandStartMarker), AdjustCommandStartMarkerConstants.Interval);
		this._tryAdjustCommandStartMarkerScheduler.schedule();

	}

	private _tryAdjustCommandStartMarker(start: IMarker) {
		if (this._store.isDisposed) {
			return;
		}
		const buffer = this._terminal.buffer.active;
		let scannedLineCount = this._tryAdjustCommandStartMarkerScannedLineCount;
		while (scannedLineCount < AdjustCommandStartMarkerConstants.MaxCheckLineCount && start.line + scannedLineCount < buffer.baseY + this._terminal.rows) {
			if (this._cursorOnNextLine()) {
				const prompt = this._getWindowsPrompt(start.line + scannedLineCount);
				if (prompt) {
					const adjustedPrompt = isString(prompt) ? prompt : prompt.prompt;
					this._capability.currentCommand.commandStartMarker = this._terminal.registerMarker(0)!;
					if (!isString(prompt) && prompt.likelySingleLine) {
						this._logService.debug('CommandDetectionCapability#_tryAdjustCommandStartMarker adjusted promptStart', `${this._capability.currentCommand.promptStartMarker?.line} -> ${this._capability.currentCommand.commandStartMarker.line}`);
						this._capability.currentCommand.promptStartMarker?.dispose();
						this._capability.currentCommand.promptStartMarker = cloneMarker(this._terminal, this._capability.currentCommand.commandStartMarker);
						const lastCommand = this._capability.commands.at(-1);
						if (lastCommand && this._capability.currentCommand.commandStartMarker.line !== lastCommand.endMarker?.line) {
							lastCommand.endMarker?.dispose();
							lastCommand.endMarker = cloneMarker(this._terminal, this._capability.currentCommand.commandStartMarker);
						}
					}
					this._capability.currentCommand.commandStartX = adjustedPrompt.length;
					this._logService.debug('CommandDetectionCapability#_tryAdjustCommandStartMarker adjusted commandStart', `${start.line} -> ${this._capability.currentCommand.commandStartMarker.line}:${this._capability.currentCommand.commandStartX}`);
					this._flushPendingHandleCommandStartTask();
					return;
				}
			}
			scannedLineCount++;
		}
		if (scannedLineCount < AdjustCommandStartMarkerConstants.MaxCheckLineCount) {
			this._tryAdjustCommandStartMarkerScannedLineCount = scannedLineCount;
			if (++this._tryAdjustCommandStartMarkerPollCount < AdjustCommandStartMarkerConstants.MaximumPollCount) {
				this._tryAdjustCommandStartMarkerScheduler?.schedule();
			} else {
				this._flushPendingHandleCommandStartTask();
			}
		} else {
			this._flushPendingHandleCommandStartTask();
		}
	}

	private _flushPendingHandleCommandStartTask() {
		if (this._tryAdjustCommandStartMarkerScheduler) {
			this._tryAdjustCommandStartMarkerPollCount = AdjustCommandStartMarkerConstants.MaximumPollCount;
			this._tryAdjustCommandStartMarkerScheduler.flush();
			this._tryAdjustCommandStartMarkerScheduler = undefined;
		}

		if (!this._capability.currentCommand.commandExecutedMarker) {
			this._onCursorMoveListener.value = this._terminal.onCursorMove(() => {
				if (this._hooks.commandMarkers.length === 0 || this._hooks.commandMarkers[this._hooks.commandMarkers.length - 1].line !== this._terminal.buffer.active.cursorY) {
					const marker = this._terminal.registerMarker(0);
					if (marker) {
						this._hooks.commandMarkers.push(marker);
					}
				}
			});
		}

		if (this._capability.currentCommand.commandStartMarker) {
			const line = this._terminal.buffer.active.getLine(this._capability.currentCommand.commandStartMarker.line);
			if (line) {
				this._capability.currentCommand.commandStartLineContent = line.translateToString(true);
			}
		}
		// eslint-disable-next-line local/code-no-dangerous-type-assertions
		this._hooks.onCommandStartedEmitter.fire({ marker: this._capability.currentCommand.commandStartMarker } as ITerminalCommand);
		this._logService.debug('CommandDetectionCapability#_handleCommandStartWindows', this._capability.currentCommand.commandStartX, this._capability.currentCommand.commandStartMarker?.line);
	}

	handleCommandExecuted(options: IHandleCommandOptions | undefined) {
		if (this._tryAdjustCommandStartMarkerScheduler) {
			this._flushPendingHandleCommandStartTask();
		}
		this._onCursorMoveListener.clear();
		this._evaluateCommandMarkers();
		this._capability.currentCommand.commandExecutedX = this._terminal.buffer.active.cursorX;
		this._hooks.onCommandExecutedEmitter.fire(this._capability.currentCommand as ITerminalCommand);
		this._logService.debug('CommandDetectionCapability#handleCommandExecuted', this._capability.currentCommand.commandExecutedX, this._capability.currentCommand.commandExecutedMarker?.line);
	}

	preHandleCommandFinished() {
		if (this._capability.currentCommand.commandExecutedMarker) {
			return;
		}
		if (this._hooks.commandMarkers.length === 0) {
			if (!this._capability.currentCommand.commandStartMarker) {
				this._capability.currentCommand.commandStartMarker = this._terminal.registerMarker(0);
			}
			if (this._capability.currentCommand.commandStartMarker) {
				this._hooks.commandMarkers.push(this._capability.currentCommand.commandStartMarker);
			}
		}
		this._evaluateCommandMarkers();
	}

	postHandleCommandFinished(): void {
		const currentCommand = this._capability.currentCommand;
		const commandText = currentCommand.command;
		const commandLine = currentCommand.commandStartMarker?.line;
		const executedLine = currentCommand.commandExecutedMarker?.line;
		if (
			!commandText || commandText.length === 0 ||
			commandLine === undefined || commandLine === -1 ||
			executedLine === undefined || executedLine === -1
		) {
			return;
		}

		let current = 0;
		let found = false;
		for (let i = commandLine; i <= executedLine; i++) {
			const line = this._terminal.buffer.active.getLine(i);
			if (!line) {
				break;
			}
			const text = line.translateToString(true);
			for (let j = 0; j < text.length; j++) {
				while (commandText.length < current && commandText[current] === ' ') {
					current++;
				}

				if (text[j] === commandText[current]) {
					current++;
				}

				if (current === commandText.length) {
					const wrapsToNextLine = j >= this._terminal.cols - 1;
					currentCommand.commandExecutedMarker = this._terminal.registerMarker(i - (this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY) + (wrapsToNextLine ? 1 : 0));
					currentCommand.commandExecutedX = wrapsToNextLine ? 0 : j + 1;
					found = true;
					break;
				}
			}
			if (found) {
				break;
			}
		}
	}

	private _evaluateCommandMarkers(): void {
		if (this._hooks.commandMarkers.length === 0) {
			return;
		}
		this._hooks.commandMarkers = this._hooks.commandMarkers.sort((a, b) => a.line - b.line);
		this._capability.currentCommand.commandStartMarker = this._hooks.commandMarkers[0];
		if (this._capability.currentCommand.commandStartMarker) {
			const line = this._terminal.buffer.active.getLine(this._capability.currentCommand.commandStartMarker.line);
			if (line) {
				this._capability.currentCommand.commandStartLineContent = line.translateToString(true);
			}
		}
		this._capability.currentCommand.commandExecutedMarker = this._hooks.commandMarkers[this._hooks.commandMarkers.length - 1];
		this._hooks.onCommandExecutedEmitter.fire(this._capability.currentCommand as ITerminalCommand);
	}

	private _cursorOnNextLine(): boolean {
		const lastCommand = this._capability.commands.at(-1);

		if (!lastCommand) {
			return true;
		}

		const cursorYAbsolute = this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY;
		const lastCommandYAbsolute = (lastCommand.endMarker ? lastCommand.endMarker.line : lastCommand.marker?.line) ?? -1;
		return cursorYAbsolute > lastCommandYAbsolute;
	}

	private _waitForCursorMove(): Promise<void> {
		const cursorX = this._terminal.buffer.active.cursorX;
		const cursorY = this._terminal.buffer.active.cursorY;
		let totalDelay = 0;
		return new Promise<void>((resolve, reject) => {
			const interval = setInterval(() => {
				if (cursorX !== this._terminal.buffer.active.cursorX || cursorY !== this._terminal.buffer.active.cursorY) {
					resolve();
					clearInterval(interval);
					return;
				}
				totalDelay += 10;
				if (totalDelay > 1000) {
					clearInterval(interval);
					resolve();
				}
			}, 10);
		});
	}

	private _getWindowsPrompt(y: number = this._terminal.buffer.active.baseY + this._terminal.buffer.active.cursorY): string | { prompt: string; likelySingleLine: true } | undefined {
		const line = this._terminal.buffer.active.getLine(y);
		if (!line) {
			return;
		}
		const lineText = line.translateToString(true);
		if (!lineText) {
			return;
		}

		const pwshPrompt = lineText.match(/(?<prompt>(\(.+\)\s)?(?:PS.+>\s?))/)?.groups?.prompt;
		if (pwshPrompt) {
			const adjustedPrompt = this._adjustPrompt(pwshPrompt, lineText, '>');
			if (adjustedPrompt) {
				return {
					prompt: adjustedPrompt,
					likelySingleLine: true
				};
			}
		}

		const customPrompt = lineText.match(/.*\u276f(?=[^\u276f]*$)/g)?.[0];
		if (customPrompt) {
			const adjustedPrompt = this._adjustPrompt(customPrompt, lineText, '\u276f');
			if (adjustedPrompt) {
				return adjustedPrompt;
			}
		}

		const bashPrompt = lineText.match(/^(?<prompt>\$)/)?.groups?.prompt;
		if (bashPrompt) {
			const adjustedPrompt = this._adjustPrompt(bashPrompt, lineText, '$');
			if (adjustedPrompt) {
				return adjustedPrompt;
			}
		}

		const pythonPrompt = lineText.match(/^(?<prompt>>>> )/g)?.groups?.prompt;
		if (pythonPrompt) {
			return {
				prompt: pythonPrompt,
				likelySingleLine: true
			};
		}

		if (this._capability.promptTerminator && (lineText === this._capability.promptTerminator || lineText.trim().endsWith(this._capability.promptTerminator))) {
			const adjustedPrompt = this._adjustPrompt(lineText, lineText, this._capability.promptTerminator);
			if (adjustedPrompt) {
				return adjustedPrompt;
			}
		}

		const cmdMatch = lineText.match(/^(?<prompt>(\(.+\)\s)?(?:[A-Z]:\\.*>))/);
		return cmdMatch?.groups?.prompt ? {
			prompt: cmdMatch.groups.prompt,
			likelySingleLine: true
		} : undefined;
	}

	private _adjustPrompt(prompt: string | undefined, lineText: string, char: string): string | undefined {
		if (!prompt) {
			return;
		}
		if (lineText === prompt && prompt.endsWith(char)) {
			prompt += ' ';
		}
		return prompt;
	}
}

export function getLinesForCommand(buffer: IBuffer, command: ITerminalCommand, cols: number, outputMatcher?: ITerminalOutputMatcher): string[] | undefined {
	if (!outputMatcher) {
		return undefined;
	}
	const executedMarker = command.executedMarker;
	const endMarker = command.endMarker;
	if (!executedMarker || !endMarker) {
		return undefined;
	}
	const startLine = executedMarker.line;
	const endLine = endMarker.line;

	const linesToCheck = outputMatcher.length;
	const lines: string[] = [];
	if (outputMatcher.anchor === 'bottom') {
		for (let i = endLine - (outputMatcher.offset || 0); i >= startLine; i--) {
			let wrappedLineStart = i;
			const wrappedLineEnd = i;
			while (wrappedLineStart >= startLine && buffer.getLine(wrappedLineStart)?.isWrapped) {
				wrappedLineStart--;
			}
			i = wrappedLineStart;
			lines.unshift(getXtermLineContent(buffer, wrappedLineStart, wrappedLineEnd, cols));
			if (lines.length > linesToCheck) {
				lines.pop();
			}
		}
	} else {
		for (let i = startLine + (outputMatcher.offset || 0); i < endLine; i++) {
			const wrappedLineStart = i;
			let wrappedLineEnd = i;
			while (wrappedLineEnd + 1 < endLine && buffer.getLine(wrappedLineEnd + 1)?.isWrapped) {
				wrappedLineEnd++;
			}
			i = wrappedLineEnd;
			lines.push(getXtermLineContent(buffer, wrappedLineStart, wrappedLineEnd, cols));
			if (lines.length === linesToCheck) {
				lines.shift();
			}
		}
	}
	return lines;
}

function getXtermLineContent(buffer: IBuffer, lineStart: number, lineEnd: number, cols: number): string {
	const maxLineLength = Math.max(2048 / cols * 2);
	lineEnd = Math.min(lineEnd, lineStart + maxLineLength);
	let content = '';
	for (let i = lineStart; i <= lineEnd; i++) {
		const line = buffer.getLine(i);
		if (line) {
			content += line.translateToString(true, 0, cols);
		}
	}
	return content;
}

function cloneMarker(xterm: Terminal, marker: IMarker, offset: number = 0): IMarker | undefined {
	return xterm.registerMarker(marker.line - (xterm.buffer.active.baseY + xterm.buffer.active.cursorY) + offset);
}
