/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IShellIntegration, ShellIntegrationStatus } from '../terminal.js';
import { Disposable, dispose, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { TerminalCapabilityStore } from '../capabilities/terminalCapabilityStore.js';
import { CommandDetectionCapability } from '../capabilities/commandDetectionCapability.js';
import { CwdDetectionCapability } from '../capabilities/cwdDetectionCapability.js';
import { IBufferMarkCapability, ICommandDetectionCapability, ICwdDetectionCapability, IPromptTypeDetectionCapability, ISerializedCommandDetectionCapability, IShellEnvDetectionCapability, TerminalCapability } from '../capabilities/capabilities.js';
import { PartialCommandDetectionCapability } from '../capabilities/partialCommandDetectionCapability.js';
import { ILogService } from '../../../log/common/log.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { BufferMarkCapability } from '../capabilities/bufferMarkCapability.js';
import type { ITerminalAddon, Terminal } from '@xterm/headless';
import { URI } from '../../../../base/common/uri.js';
import { sanitizeCwd } from '../terminalEnvironment.js';
import { removeAnsiEscapeCodesFromPrompt } from '../../../../base/common/strings.js';
import { ShellEnvDetectionCapability } from '../capabilities/shellEnvDetectionCapability.js';
import { PromptTypeDetectionCapability } from '../capabilities/promptTypeDetectionCapability.js';


export const enum ShellIntegrationOscPs {
	FinalTerm = 133,
	VSCode = 633,
	ITerm = 1337,
	SetCwd = 7,
	SetWindowsFriendlyCwd = 9
}

const enum FinalTermOscPt {
	PromptStart = 'A',

	CommandStart = 'B',

	CommandExecuted = 'C',

	CommandFinished = 'D',
}

const enum VSCodeOscPt {
	PromptStart = 'A',

	CommandStart = 'B',

	CommandExecuted = 'C',

	CommandFinished = 'D',

	CommandLine = 'E',

	ContinuationStart = 'F',

	ContinuationEnd = 'G',

	RightPromptStart = 'H',

	RightPromptEnd = 'I',

	Property = 'P',

	SetMark = 'SetMark',

	EnvJson = 'EnvJson',

	EnvSingleDelete = 'EnvSingleDelete',

	EnvSingleStart = 'EnvSingleStart',

	EnvSingleEntry = 'EnvSingleEntry',

	EnvSingleEnd = 'EnvSingleEnd'
}

const enum ITermOscPt {
	SetMark = 'SetMark',

	CurrentDir = 'CurrentDir'
}

export class ShellIntegrationAddon extends Disposable implements IShellIntegration, ITerminalAddon {
	private _terminal?: Terminal;
	readonly capabilities = this._register(new TerminalCapabilityStore());
	private _hasUpdatedTelemetry: boolean = false;
	private _activationTimeout: Timeout | undefined;
	private _commonProtocolDisposables: IDisposable[] = [];

	private _seenSequences: Set<string> = new Set();
	get seenSequences(): ReadonlySet<string> { return this._seenSequences; }

	private _status: ShellIntegrationStatus = ShellIntegrationStatus.Off;
	get status(): ShellIntegrationStatus { return this._status; }

	private readonly _onDidChangeStatus = this._register(new Emitter<ShellIntegrationStatus>());
	readonly onDidChangeStatus = this._onDidChangeStatus.event;
	private readonly _onDidChangeSeenSequences = this._register(new Emitter<ReadonlySet<string>>());
	readonly onDidChangeSeenSequences = this._onDidChangeSeenSequences.event;

	constructor(
		private _nonce: string,
		private readonly _disableTelemetry: boolean | undefined,
		private _onDidExecuteText: Event<void> | undefined,
		private readonly _telemetryService: ITelemetryService | undefined,
		private readonly _logService: ILogService
	) {
		super();
		this._register(toDisposable(() => {
			this._clearActivationTimeout();
			this._disposeCommonProtocol();
		}));
	}

	private _disposeCommonProtocol(): void {
		dispose(this._commonProtocolDisposables);
		this._commonProtocolDisposables.length = 0;
	}

	activate(xterm: Terminal) {
		this._terminal = xterm;
		this.capabilities.add(TerminalCapability.PartialCommandDetection, this._register(new PartialCommandDetectionCapability(this._terminal, this._onDidExecuteText)));
		this._register(xterm.parser.registerOscHandler(ShellIntegrationOscPs.VSCode, data => this._handleVSCodeSequence(data)));
		this._register(xterm.parser.registerOscHandler(ShellIntegrationOscPs.ITerm, data => this._doHandleITermSequence(data)));
		this._commonProtocolDisposables.push(
			xterm.parser.registerOscHandler(ShellIntegrationOscPs.FinalTerm, data => this._handleFinalTermSequence(data))
		);
		this._register(xterm.parser.registerOscHandler(ShellIntegrationOscPs.SetCwd, data => this._doHandleSetCwd(data)));
		this._register(xterm.parser.registerOscHandler(ShellIntegrationOscPs.SetWindowsFriendlyCwd, data => this._doHandleSetWindowsFriendlyCwd(data)));
		this._ensureCapabilitiesOrAddFailureTelemetry();
	}

	getMarkerId(terminal: Terminal, vscodeMarkerId: string) {
		this._createOrGetBufferMarkDetection(terminal).getMark(vscodeMarkerId);
	}

	setNextCommandId(command: string, commandId: string): void {
		if (this._terminal) {
			this._createOrGetCommandDetection(this._terminal).setNextCommandId(command, commandId);
		}
	}

	private _markSequenceSeen(sequence: string) {
		if (!this._seenSequences.has(sequence)) {
			this._seenSequences.add(sequence);
			this._onDidChangeSeenSequences.fire(this._seenSequences);
		}
	}

	private _handleFinalTermSequence(data: string): boolean {
		const didHandle = this._doHandleFinalTermSequence(data);
		if (this._status === ShellIntegrationStatus.Off) {
			this._status = ShellIntegrationStatus.FinalTerm;
			this._onDidChangeStatus.fire(this._status);
		}
		return didHandle;
	}

	private _doHandleFinalTermSequence(data: string): boolean {
		if (!this._terminal) {
			return false;
		}

		const [command, ...args] = data.split(';');
		this._logService.trace(`ShellIntegrationAddon#_doHandleFinalTermSequence: received sequence ${command}`);
		this._markSequenceSeen(command);
		switch (command) {
			case FinalTermOscPt.PromptStart:
				this._createOrGetCommandDetection(this._terminal).handlePromptStart();
				return true;
			case FinalTermOscPt.CommandStart:
				this._createOrGetCommandDetection(this._terminal).handleCommandStart({ ignoreCommandLine: true });
				return true;
			case FinalTermOscPt.CommandExecuted:
				this._createOrGetCommandDetection(this._terminal).handleCommandExecuted();
				return true;
			case FinalTermOscPt.CommandFinished: {
				const exitCode = args.length === 1 ? parseInt(args[0]) : undefined;
				this._createOrGetCommandDetection(this._terminal).handleCommandFinished(exitCode);
				return true;
			}
		}
		return false;
	}

	private _handleVSCodeSequence(data: string): boolean {
		const didHandle = this._doHandleVSCodeSequence(data);
		if (!this._hasUpdatedTelemetry && didHandle) {
			this._telemetryService?.publicLog2<{}, { owner: 'meganrogge'; comment: 'Indicates shell integration was activated' }>('terminal/shellIntegrationActivationSucceeded');
			this._hasUpdatedTelemetry = true;
			this._clearActivationTimeout();
		}
		if (this._status !== ShellIntegrationStatus.VSCode) {
			this._status = ShellIntegrationStatus.VSCode;
			this._onDidChangeStatus.fire(this._status);
		}
		return didHandle;
	}

	private async _ensureCapabilitiesOrAddFailureTelemetry(): Promise<void> {
		if (!this._telemetryService || this._disableTelemetry) {
			return;
		}
		this._activationTimeout = setTimeout(() => {
			if (!this.capabilities.get(TerminalCapability.CommandDetection) && !this.capabilities.get(TerminalCapability.CwdDetection)) {
				this._telemetryService?.publicLog2<{}, { owner: 'meganrogge'; comment: 'Indicates shell integration activation timeout' }>('terminal/shellIntegrationActivationTimeout');
				this._logService.warn('Shell integration failed to add capabilities within 10 seconds');
			}
			this._hasUpdatedTelemetry = true;
		}, 10000);
	}

	private _clearActivationTimeout(): void {
		if (this._activationTimeout !== undefined) {
			clearTimeout(this._activationTimeout);
			this._activationTimeout = undefined;
		}
	}

	private _doHandleVSCodeSequence(data: string): boolean {
		if (!this._terminal) {
			return false;
		}

		const argsIndex = data.indexOf(';');
		const command = argsIndex === -1 ? data : data.substring(0, argsIndex);
		this._logService.trace(`ShellIntegrationAddon#_doHandleVSCodeSequence: received sequence ${command}`);
		this._markSequenceSeen(command);
		const args: (string | undefined)[] = argsIndex === -1 ? [] : data.substring(argsIndex + 1).split(';');
		switch (command) {
			case VSCodeOscPt.PromptStart:
				this._createOrGetCommandDetection(this._terminal).handlePromptStart();
				return true;
			case VSCodeOscPt.CommandStart:
				this._createOrGetCommandDetection(this._terminal).handleCommandStart();
				return true;
			case VSCodeOscPt.CommandExecuted:
				this._createOrGetCommandDetection(this._terminal).handleCommandExecuted();
				return true;
			case VSCodeOscPt.CommandFinished: {
				const arg0 = args[0];
				const exitCode = arg0 !== undefined ? parseInt(arg0) : undefined;
				this._createOrGetCommandDetection(this._terminal).handleCommandFinished(exitCode);
				return true;
			}
			case VSCodeOscPt.CommandLine: {
				const arg0 = args[0];
				const arg1 = args[1];
				let commandLine: string;
				if (arg0 !== undefined) {
					commandLine = deserializeVSCodeOscMessage(arg0);
				} else {
					commandLine = '';
				}
				this._createOrGetCommandDetection(this._terminal).setCommandLine(commandLine, arg1 === this._nonce);
				return true;
			}
			case VSCodeOscPt.ContinuationStart: {
				this._createOrGetCommandDetection(this._terminal).handleContinuationStart();
				return true;
			}
			case VSCodeOscPt.ContinuationEnd: {
				this._createOrGetCommandDetection(this._terminal).handleContinuationEnd();
				return true;
			}
			case VSCodeOscPt.EnvJson: {
				const arg0 = args[0];
				const arg1 = args[1];
				if (arg0 !== undefined) {
					try {
						const env = JSON.parse(deserializeVSCodeOscMessage(arg0));
						this._createOrGetShellEnvDetection().setEnvironment(env, arg1 === this._nonce);
					} catch (e) {
						this._logService.warn('Failed to parse environment from shell integration sequence', arg0);
					}
				}
				return true;
			}
			case VSCodeOscPt.EnvSingleStart: {
				this._createOrGetShellEnvDetection().startEnvironmentSingleVar(args[0] === '1', args[1] === this._nonce);
				return true;
			}
			case VSCodeOscPt.EnvSingleDelete: {
				const arg0 = args[0];

				const arg1 = args[1];
				const arg2 = args[2];
				if (arg0 !== undefined && arg1 !== undefined) {
					const env = deserializeVSCodeOscMessage(arg1);
					this._createOrGetShellEnvDetection().deleteEnvironmentSingleVar(arg0, env, arg2 === this._nonce);
				}
				return true;
			}
			case VSCodeOscPt.EnvSingleEntry: {
				const arg0 = args[0];
				const arg1 = args[1];
				const arg2 = args[2];
				if (arg0 !== undefined && arg1 !== undefined) {
					const env = deserializeVSCodeOscMessage(arg1);
					this._createOrGetShellEnvDetection().setEnvironmentSingleVar(arg0, env, arg2 === this._nonce);
				}
				return true;
			}
			case VSCodeOscPt.EnvSingleEnd: {
				this._createOrGetShellEnvDetection().endEnvironmentSingleVar(args[0] === this._nonce);
				return true;
			}
			case VSCodeOscPt.RightPromptStart: {
				this._createOrGetCommandDetection(this._terminal).handleRightPromptStart();
				return true;
			}
			case VSCodeOscPt.RightPromptEnd: {
				this._createOrGetCommandDetection(this._terminal).handleRightPromptEnd();
				return true;
			}
			case VSCodeOscPt.Property: {
				const arg0 = args[0];
				const deserialized = arg0 !== undefined ? deserializeVSCodeOscMessage(arg0) : '';
				const { key, value } = parseKeyValueAssignment(deserialized);
				if (value === undefined) {
					return true;
				}
				switch (key) {
					case 'ContinuationPrompt': {
						this._updateContinuationPrompt(removeAnsiEscapeCodesFromPrompt(value));
						return true;
					}
					case 'Cwd': {
						const nonce = args[1];
						this._updateCwd(value, nonce !== undefined && nonce === this._nonce);
						return true;
					}
					case 'IsWindows': {
						this._createOrGetCommandDetection(this._terminal).setIsWindowsPty(value === 'True' ? true : false);
						return true;
					}
					case 'HasRichCommandDetection': {
						this._createOrGetCommandDetection(this._terminal).setHasRichCommandDetection(value === 'True' ? true : false);
						return true;
					}
					case 'Prompt': {
						const sanitizedValue = value.replace(/\x1b\[[0-9;]*m/g, '');
						this._updatePromptTerminator(sanitizedValue);
						return true;
					}
					case 'PromptType': {
						this._createOrGetPromptTypeDetection().setPromptType(value);
						return true;
					}
					case 'Task': {
						this._createOrGetBufferMarkDetection(this._terminal);
						this.capabilities.get(TerminalCapability.CommandDetection)?.setIsCommandStorageDisabled();
						return true;
					}
				}
			}
			case VSCodeOscPt.SetMark: {
				this._createOrGetBufferMarkDetection(this._terminal).addMark(parseMarkSequence(args));
				return true;
			}
		}

		return false;
	}

	private _updateContinuationPrompt(value: string) {
		if (!this._terminal) {
			return;
		}
		this._createOrGetCommandDetection(this._terminal).setContinuationPrompt(value);
	}

	private _updatePromptTerminator(prompt: string) {
		if (!this._terminal) {
			return;
		}
		const lastPromptLine = prompt.substring(prompt.lastIndexOf('\n') + 1);
		const lastPromptLineTrimmed = lastPromptLine.trim();
		const promptTerminator = (
			lastPromptLineTrimmed.length === 1
				? lastPromptLine
				: lastPromptLine.substring(lastPromptLine.lastIndexOf(' '))
		);
		if (promptTerminator) {
			this._createOrGetCommandDetection(this._terminal).setPromptTerminator(promptTerminator, lastPromptLine);
		}
	}

	private _updateCwd(value: string, isTrusted: boolean = true) {
		value = sanitizeCwd(value);
		this._createOrGetCwdDetection().updateCwd(value, isTrusted);
		const commandDetection = this.capabilities.get(TerminalCapability.CommandDetection);
		commandDetection?.setCwd(value);
	}

	private _doHandleITermSequence(data: string): boolean {
		if (!this._terminal) {
			return false;
		}

		const [command] = data.split(';');
		this._markSequenceSeen(`${ShellIntegrationOscPs.ITerm};${command}`);
		switch (command) {
			case ITermOscPt.SetMark: {
				this._createOrGetBufferMarkDetection(this._terminal).addMark();
			}
			default: {
				const { key, value } = parseKeyValueAssignment(command);

				if (value === undefined) {
					return true;
				}

				switch (key) {
					case ITermOscPt.CurrentDir:
						this._updateCwd(value, false);
						return true;
				}
			}
		}

		return false;
	}

	private _doHandleSetWindowsFriendlyCwd(data: string): boolean {
		if (!this._terminal) {
			return false;
		}

		const [command, ...args] = data.split(';');
		this._markSequenceSeen(`${ShellIntegrationOscPs.SetWindowsFriendlyCwd};${command}`);
		switch (command) {
			case '9':
				if (args.length) {
					this._updateCwd(args[0], false);
				}
				return true;
		}

		return false;
	}

	private _doHandleSetCwd(data: string): boolean {
		if (!this._terminal) {
			return false;
		}

		const [command] = data.split(';');
		this._markSequenceSeen(`${ShellIntegrationOscPs.SetCwd};${command}`);

		if (command.match(/^file:\/\/.*\//)) {
			const uri = URI.parse(command);
			if (uri.path && uri.path.length > 0) {
				this._updateCwd(uri.path, false);
				return true;
			}
		}

		return false;
	}

	serialize(): ISerializedCommandDetectionCapability {
		if (!this._terminal || !this.capabilities.has(TerminalCapability.CommandDetection)) {
			return {
				isWindowsPty: false,
				hasRichCommandDetection: false,
				commands: [],
				promptInputModel: undefined,
			};
		}
		const result = this._createOrGetCommandDetection(this._terminal).serialize();
		return result;
	}

	deserialize(serialized: ISerializedCommandDetectionCapability): void {
		if (!this._terminal) {
			throw new Error('Cannot restore commands before addon is activated');
		}
		const commandDetection = this._createOrGetCommandDetection(this._terminal);
		commandDetection.deserialize(serialized);
		if (commandDetection.cwd) {
			this._updateCwd(commandDetection.cwd, false);
		}
	}

	protected _createOrGetCwdDetection(): ICwdDetectionCapability {
		let cwdDetection = this.capabilities.get(TerminalCapability.CwdDetection);
		if (!cwdDetection) {
			cwdDetection = this._register(new CwdDetectionCapability());
			this.capabilities.add(TerminalCapability.CwdDetection, cwdDetection);
		}
		return cwdDetection;
	}

	protected _createOrGetCommandDetection(terminal: Terminal): ICommandDetectionCapability {
		let commandDetection = this.capabilities.get(TerminalCapability.CommandDetection);
		if (!commandDetection) {
			commandDetection = this._register(new CommandDetectionCapability(terminal, this._logService));
			this.capabilities.add(TerminalCapability.CommandDetection, commandDetection);
		}
		return commandDetection;
	}

	protected _createOrGetBufferMarkDetection(terminal: Terminal): IBufferMarkCapability {
		let bufferMarkDetection = this.capabilities.get(TerminalCapability.BufferMarkDetection);
		if (!bufferMarkDetection) {
			bufferMarkDetection = this._register(new BufferMarkCapability(terminal));
			this.capabilities.add(TerminalCapability.BufferMarkDetection, bufferMarkDetection);
		}
		return bufferMarkDetection;
	}

	protected _createOrGetShellEnvDetection(): IShellEnvDetectionCapability {
		let shellEnvDetection = this.capabilities.get(TerminalCapability.ShellEnvDetection);
		if (!shellEnvDetection) {
			shellEnvDetection = this._register(new ShellEnvDetectionCapability());
			this.capabilities.add(TerminalCapability.ShellEnvDetection, shellEnvDetection);
		}
		return shellEnvDetection;
	}

	protected _createOrGetPromptTypeDetection(): IPromptTypeDetectionCapability {
		let promptTypeDetection = this.capabilities.get(TerminalCapability.PromptTypeDetection);
		if (!promptTypeDetection) {
			promptTypeDetection = this._register(new PromptTypeDetectionCapability());
			this.capabilities.add(TerminalCapability.PromptTypeDetection, promptTypeDetection);
		}
		return promptTypeDetection;
	}
}

export function deserializeVSCodeOscMessage(message: string): string {
	return message.replaceAll(
		/\\(\\|x([0-9a-f]{2}))/gi,
		(_match: string, op: string, hex?: string) => hex ? String.fromCharCode(parseInt(hex, 16)) : op);
}

export function serializeVSCodeOscMessage(message: string): string {
	return message.replace(
		/[\\;\x00-\x20]/g,
		(char: string) => {
			if (char === '\\') {
				return '\\\\';
			}
			const charCode = char.charCodeAt(0);
			return `\\x${charCode.toString(16).padStart(2, '0')}`;
		}
	);
}

export function parseKeyValueAssignment(message: string): { key: string; value: string | undefined } {
	const separatorIndex = message.indexOf('=');
	if (separatorIndex === -1) {
		return { key: message, value: undefined };
	}
	return {
		key: message.substring(0, separatorIndex),
		value: message.substring(1 + separatorIndex)
	};
}


export function parseMarkSequence(sequence: (string | undefined)[]): { id?: string; hidden?: boolean } {
	let id = undefined;
	let hidden = false;
	for (const property of sequence) {
		if (property === undefined) {
			continue;
		}
		if (property === 'Hidden') {
			hidden = true;
		}
		if (property.startsWith('Id=')) {
			id = property.substring(3);
		}
	}
	return { id, hidden };
}
