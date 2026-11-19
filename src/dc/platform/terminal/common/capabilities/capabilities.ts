/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import type { IPromptInputModel, ISerializedPromptInputModel } from './commandDetection/promptInputModel.js';
import { ICurrentPartialCommand } from './commandDetection/terminalCommand.js';
import { ITerminalOutputMatch, ITerminalOutputMatcher } from '../terminal.js';
import { ReplayEntry } from '../terminalProcess.js';
import type { IMarker } from '@xterm/headless';

export const enum TerminalCapability {
	CwdDetection,
	NaiveCwdDetection,
	CommandDetection,
	PartialCommandDetection,

	BufferMarkDetection,

	ShellEnvDetection,

	PromptTypeDetection,
}

export interface ITerminalCapabilityStore {
	readonly items: IterableIterator<TerminalCapability>;

	readonly onDidAddCapability: Event<AnyTerminalCapabilityChangeEvent>;

	readonly onDidRemoveCapability: Event<AnyTerminalCapabilityChangeEvent>;

	readonly onDidChangeCapabilities: Event<void>;

	readonly onDidAddCommandDetectionCapability: Event<ICommandDetectionCapability>;
	readonly onDidRemoveCommandDetectionCapability: Event<void>;
	readonly onDidAddCwdDetectionCapability: Event<ICwdDetectionCapability>;
	readonly onDidRemoveCwdDetectionCapability: Event<void>;

	createOnDidAddCapabilityOfTypeEvent<T extends TerminalCapability>(type: T): Event<ITerminalCapabilityImplMap[T]>;

	createOnDidRemoveCapabilityOfTypeEvent<T extends TerminalCapability>(type: T): Event<ITerminalCapabilityImplMap[T]>;

	has(capability: TerminalCapability): boolean;

	get<T extends TerminalCapability>(capability: T): ITerminalCapabilityImplMap[T] | undefined;
}

export interface TerminalCapabilityChangeEvent<T extends TerminalCapability> {
	id: T;
	capability: ITerminalCapabilityImplMap[T];
}

export type AnyTerminalCapabilityChangeEvent = {
	[K in TerminalCapability]: TerminalCapabilityChangeEvent<K>
}[TerminalCapability];

export interface ITerminalCapabilityImplMap {
	[TerminalCapability.CwdDetection]: ICwdDetectionCapability;
	[TerminalCapability.CommandDetection]: ICommandDetectionCapability;
	[TerminalCapability.NaiveCwdDetection]: INaiveCwdDetectionCapability;
	[TerminalCapability.PartialCommandDetection]: IPartialCommandDetectionCapability;
	[TerminalCapability.BufferMarkDetection]: IBufferMarkCapability;
	[TerminalCapability.ShellEnvDetection]: IShellEnvDetectionCapability;
	[TerminalCapability.PromptTypeDetection]: IPromptTypeDetectionCapability;
}

export interface ICwdDetectionCapability {
	readonly type: TerminalCapability.CwdDetection;
	readonly onDidChangeCwd: Event<string>;
	readonly cwds: string[];
	readonly isTrusted: boolean;
	getCwd(): string;
	updateCwd(cwd: string, isTrusted?: boolean): void;
}

export interface IShellEnvDetectionCapability {
	readonly type: TerminalCapability.ShellEnvDetection;
	readonly onDidChangeEnv: Event<TerminalShellIntegrationEnvironment>;
	get env(): TerminalShellIntegrationEnvironment;
	setEnvironment(envs: { [key: string]: string | undefined } | undefined, isTrusted: boolean): void;
	startEnvironmentSingleVar(clear: boolean, isTrusted: boolean): void;
	setEnvironmentSingleVar(key: string, value: string | undefined, isTrusted: boolean): void;
	deleteEnvironmentSingleVar(key: string, value: string | undefined, isTrusted: boolean): void;
	endEnvironmentSingleVar(isTrusted: boolean): void;
}

export interface IPromptTypeDetectionCapability {
	readonly type: TerminalCapability.PromptTypeDetection;
	readonly promptType: string | undefined;
	readonly onPromptTypeChanged: Event<string | undefined>;
	setPromptType(value: string): void;
}

export interface TerminalShellIntegrationEnvironment {
	value: { [key: string]: string | undefined } | undefined;

	isTrusted: boolean;
}

export interface TerminalShellIntegration {
	readonly env: TerminalShellIntegrationEnvironment;
}

export const enum CommandInvalidationReason {
	Windows = 'windows',
	NoProblemsReported = 'noProblemsReported'
}

export interface ICommandInvalidationRequest {
	reason: CommandInvalidationReason;
}

export interface IBufferMarkCapability {
	type: TerminalCapability.BufferMarkDetection;
	markers(): IterableIterator<IMarker>;
	readonly onMarkAdded: Event<IMarkProperties>;
	addMark(properties?: IMarkProperties): void;
	getMark(id: string): IMarker | undefined;
}

export interface ICommandDetectionCapability {
	readonly type: TerminalCapability.CommandDetection;
	readonly promptInputModel: IPromptInputModel;
	readonly commands: readonly ITerminalCommand[];
	readonly executingCommand: string | undefined;
	readonly executingCommandObject: ITerminalCommand | undefined;
	readonly executingCommandConfidence: 'low' | 'medium' | 'high' | undefined;
	readonly cwd: string | undefined;
	readonly hasRichCommandDetection: boolean;
	readonly currentCommand: ICurrentPartialCommand | undefined;
	readonly onCommandStarted: Event<ITerminalCommand>;
	readonly onCommandFinished: Event<ITerminalCommand>;
	readonly onCommandExecuted: Event<ITerminalCommand>;
	readonly onCommandInvalidated: Event<ITerminalCommand[]>;
	readonly onCurrentCommandInvalidated: Event<ICommandInvalidationRequest>;
	readonly onSetRichCommandDetection: Event<boolean>;
	setContinuationPrompt(value: string): void;
	setPromptTerminator(value: string, lastPromptLine: string): void;
	setCwd(value: string): void;
	setIsWindowsPty(value: boolean): void;
	setIsCommandStorageDisabled(): void;
	getCwdForLine(line: number): string | undefined;
	getCommandForLine(line: number): ITerminalCommand | ICurrentPartialCommand | undefined;
	handlePromptStart(options?: IHandleCommandOptions): void;
	handleContinuationStart(): void;
	handleContinuationEnd(): void;
	handleRightPromptStart(): void;
	handleRightPromptEnd(): void;
	handleCommandStart(options?: IHandleCommandOptions): void;
	handleCommandExecuted(options?: IHandleCommandOptions): void;
	handleCommandFinished(exitCode?: number, options?: IHandleCommandOptions): void;
	setHasRichCommandDetection(value: boolean): void;
	setCommandLine(commandLine: string, isTrusted: boolean): void;
	setNextCommandId(command: string, commandId: string): void;
	serialize(): ISerializedCommandDetectionCapability;
	deserialize(serialized: ISerializedCommandDetectionCapability): void;
}

export interface IHandleCommandOptions {
	ignoreCommandLine?: boolean;
	marker?: IMarker;

	markProperties?: IMarkProperties;
}

export interface INaiveCwdDetectionCapability {
	readonly type: TerminalCapability.NaiveCwdDetection;
	readonly onDidChangeCwd: Event<string>;
	getCwd(): Promise<string>;
}

export interface IPartialCommandDetectionCapability {
	readonly type: TerminalCapability.PartialCommandDetection;
	readonly commands: readonly IMarker[];
	readonly onCommandFinished: Event<IMarker>;
}

interface IBaseTerminalCommand {
	command: string;
	commandLineConfidence: 'low' | 'medium' | 'high';
	isTrusted: boolean;
	timestamp: number;
	duration: number;
	id: string | undefined;

	cwd: string | undefined;
	exitCode: number | undefined;
	commandStartLineContent: string | undefined;
	markProperties: IMarkProperties | undefined;
	executedX: number | undefined;
	startX: number | undefined;
}

export interface ITerminalCommand extends IBaseTerminalCommand {
	readonly promptStartMarker?: IMarker;
	readonly marker?: IMarker;
	endMarker?: IMarker;
	readonly executedMarker?: IMarker;
	readonly aliases?: string[][];
	readonly wasReplayed?: boolean;

	extractCommandLine(): string;
	getOutput(): string | undefined;
	getOutputMatch(outputMatcher: ITerminalOutputMatcher): ITerminalOutputMatch | undefined;
	hasOutput(): boolean;
	getPromptRowCount(): number;
	getCommandRowCount(): number;
}

export interface ISerializedTerminalCommand extends IBaseTerminalCommand {
	startLine: number | undefined;
	promptStartLine: number | undefined;
	endLine: number | undefined;
	executedLine: number | undefined;
}


export interface IMarkProperties {
	hoverMessage?: string;
	disableCommandStorage?: boolean;
	hidden?: boolean;
	marker?: IMarker;
	id?: string;
}
export interface ISerializedCommandDetectionCapability {
	isWindowsPty: boolean;
	hasRichCommandDetection: boolean;
	commands: ISerializedTerminalCommand[];
	promptInputModel: ISerializedPromptInputModel | undefined;
}
export interface IPtyHostProcessReplayEvent {
	events: ReplayEntry[];
	commands: ISerializedCommandDetectionCapability;
}
