/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import * as Types from '../../../../base/common/types.js';
import * as resources from '../../../../base/common/resources.js';
import { IJSONSchemaMap } from '../../../../base/common/jsonSchema.js';
import * as Objects from '../../../../base/common/objects.js';
import { UriComponents, URI } from '../../../../base/common/uri.js';

import { ProblemMatcher } from './problemMatcher.js';
import { IWorkspaceFolder, IWorkspace } from '../../../../platform/workspace/common/workspace.js';
import { RawContextKey, ContextKeyExpression } from '../../../../platform/contextkey/common/contextkey.js';
import { TaskDefinitionRegistry } from './taskDefinitionRegistry.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { TerminalExitReason } from '../../../../platform/terminal/common/terminal.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';



export const USER_TASKS_GROUP_KEY = 'settings';

export const TASK_RUNNING_STATE = new RawContextKey<boolean>('taskRunning', false, nls.localize('tasks.taskRunningContext', "Whether a task is currently running."));
export const TASK_TERMINAL_ACTIVE = new RawContextKey<boolean>('taskTerminalActive', false, nls.localize('taskTerminalActive', "Whether the active terminal is a task terminal."));
export const TASKS_CATEGORY = nls.localize2('tasksCategory', "Tasks");

export enum ShellQuoting {
	Escape = 1,

	Strong = 2,

	Weak = 3,
}

export const CUSTOMIZED_TASK_TYPE = '$customized';

export namespace ShellQuoting {
	export function from(this: void, value: string): ShellQuoting {
		if (!value) {
			return ShellQuoting.Strong;
		}
		switch (value.toLowerCase()) {
			case 'escape':
				return ShellQuoting.Escape;
			case 'strong':
				return ShellQuoting.Strong;
			case 'weak':
				return ShellQuoting.Weak;
			default:
				return ShellQuoting.Strong;
		}
	}
}

export interface IShellQuotingOptions {
	escape?: string | {
		escapeChar: string;
		charsToEscape: string;
	};

	strong?: string;

	weak?: string;
}

export interface IShellConfiguration {
	executable?: string;

	args?: string[];

	quoting?: IShellQuotingOptions;
}

export interface CommandOptions {

	shell?: IShellConfiguration;

	cwd?: string;

	env?: { [key: string]: string };
}

export namespace CommandOptions {
	export const defaults: CommandOptions = { cwd: '${workspaceFolder}' };
}

export enum RevealKind {
	Always = 1,

	Silent = 2,

	Never = 3
}

export namespace RevealKind {
	export function fromString(this: void, value: string): RevealKind {
		switch (value.toLowerCase()) {
			case 'always':
				return RevealKind.Always;
			case 'silent':
				return RevealKind.Silent;
			case 'never':
				return RevealKind.Never;
			default:
				return RevealKind.Always;
		}
	}
}

export enum RevealProblemKind {
	Never = 1,


	OnProblem = 2,

	Always = 3
}

export namespace RevealProblemKind {
	export function fromString(this: void, value: string): RevealProblemKind {
		switch (value.toLowerCase()) {
			case 'always':
				return RevealProblemKind.Always;
			case 'never':
				return RevealProblemKind.Never;
			case 'onproblem':
				return RevealProblemKind.OnProblem;
			default:
				return RevealProblemKind.OnProblem;
		}
	}
}

export enum PanelKind {

	Shared = 1,

	Dedicated = 2,

	New = 3
}

export namespace PanelKind {
	export function fromString(value: string): PanelKind {
		switch (value.toLowerCase()) {
			case 'shared':
				return PanelKind.Shared;
			case 'dedicated':
				return PanelKind.Dedicated;
			case 'new':
				return PanelKind.New;
			default:
				return PanelKind.Shared;
		}
	}
}

export interface IPresentationOptions {
	reveal: RevealKind;

	revealProblems: RevealProblemKind;

	echo: boolean;

	focus: boolean;

	panel: PanelKind;

	showReuseMessage: boolean;

	clear: boolean;

	group?: string;

	close?: boolean;

	preserveTerminalName?: boolean;
}

export namespace PresentationOptions {
	export const defaults: IPresentationOptions = {
		echo: true, reveal: RevealKind.Always, revealProblems: RevealProblemKind.Never, focus: false, panel: PanelKind.Shared, showReuseMessage: true, clear: false, preserveTerminalName: false
	};
}

export enum RuntimeType {
	Shell = 1,
	Process = 2,
	CustomExecution = 3
}

export namespace RuntimeType {
	export function fromString(value: string): RuntimeType {
		switch (value.toLowerCase()) {
			case 'shell':
				return RuntimeType.Shell;
			case 'process':
				return RuntimeType.Process;
			case 'customExecution':
				return RuntimeType.CustomExecution;
			default:
				return RuntimeType.Process;
		}
	}
	export function toString(value: RuntimeType): string {
		switch (value) {
			case RuntimeType.Shell: return 'shell';
			case RuntimeType.Process: return 'process';
			case RuntimeType.CustomExecution: return 'customExecution';
			default: return 'process';
		}
	}
}

export interface IQuotedString {
	value: string;
	quoting: ShellQuoting;
}

export type CommandString = string | IQuotedString;

export namespace CommandString {
	export function value(value: CommandString): string {
		if (Types.isString(value)) {
			return value;
		} else {
			return value.value;
		}
	}
}

export interface ICommandConfiguration {

	runtime?: RuntimeType;

	name?: CommandString;

	options?: CommandOptions;

	args?: CommandString[];

	taskSelector?: string;





	suppressTaskName?: boolean;

	presentation?: IPresentationOptions;
}

export namespace TaskGroup {
	export const Clean: TaskGroup = { _id: 'clean', isDefault: false };

	export const Build: TaskGroup = { _id: 'build', isDefault: false };

	export const Rebuild: TaskGroup = { _id: 'rebuild', isDefault: false };

	export const Test: TaskGroup = { _id: 'test', isDefault: false };

	export function is(value: unknown): value is string {
		return value === Clean._id || value === Build._id || value === Rebuild._id || value === Test._id;
	}

	export function from(value: string | TaskGroup | undefined): TaskGroup | undefined {
		if (value === undefined) {
			return undefined;
		} else if (Types.isString(value)) {
			if (is(value)) {
				return { _id: value, isDefault: false };
			}
			return undefined;
		} else {
			return value;
		}
	}
}

export interface TaskGroup {
	_id: string;
	isDefault?: boolean | string;
}

export const enum TaskScope {
	Global = 1,
	Workspace = 2,
	Folder = 3
}

export namespace TaskSourceKind {
	export const Workspace: 'workspace' = 'workspace';
	export const Extension: 'extension' = 'extension';
	export const InMemory: 'inMemory' = 'inMemory';
	export const WorkspaceFile: 'workspaceFile' = 'workspaceFile';
	export const User: 'user' = 'user';

	export function toConfigurationTarget(kind: string): ConfigurationTarget {
		switch (kind) {
			case TaskSourceKind.User: return ConfigurationTarget.USER;
			case TaskSourceKind.WorkspaceFile: return ConfigurationTarget.WORKSPACE;
			default: return ConfigurationTarget.WORKSPACE_FOLDER;
		}
	}
}

export interface ITaskSourceConfigElement {
	workspaceFolder?: IWorkspaceFolder;
	workspace?: IWorkspace;
	file: string;
	index: number;
	element: unknown;
}

export interface ITaskConfig {
	label: string;
	task?: CommandString;
	type?: string;
	command?: string | CommandString;
	args?: string[] | CommandString[];
	presentation?: IPresentationOptions;
	isBackground?: boolean;
	problemMatcher?: Types.SingleOrMany<string>;
	group?: string | TaskGroup;
}

interface IBaseTaskSource {
	readonly kind: string;
	readonly label: string;
}

export interface IWorkspaceTaskSource extends IBaseTaskSource {
	readonly kind: 'workspace';
	readonly config: ITaskSourceConfigElement;
	readonly customizes?: KeyedTaskIdentifier;
}

export interface IExtensionTaskSource extends IBaseTaskSource {
	readonly kind: 'extension';
	readonly extension?: string;
	readonly scope: TaskScope;
	readonly workspaceFolder: IWorkspaceFolder | undefined;
}

export interface IExtensionTaskSourceTransfer {
	__workspaceFolder: UriComponents;
	__definition: { type: string;[name: string]: unknown };
}

export interface IInMemoryTaskSource extends IBaseTaskSource {
	readonly kind: 'inMemory';
}

export interface IUserTaskSource extends IBaseTaskSource {
	readonly kind: 'user';
	readonly config: ITaskSourceConfigElement;
	readonly customizes?: KeyedTaskIdentifier;
}

export interface WorkspaceFileTaskSource extends IBaseTaskSource {
	readonly kind: 'workspaceFile';
	readonly config: ITaskSourceConfigElement;
	readonly customizes?: KeyedTaskIdentifier;
}

export type TaskSource = IWorkspaceTaskSource | IExtensionTaskSource | IInMemoryTaskSource | IUserTaskSource | WorkspaceFileTaskSource;
export type FileBasedTaskSource = IWorkspaceTaskSource | IUserTaskSource | WorkspaceFileTaskSource;
export interface ITaskIdentifier {
	type: string;
	[name: string]: unknown;
}

export interface KeyedTaskIdentifier extends ITaskIdentifier {
	_key: string;
}

export interface ITaskDependency {
	uri: URI | string;
	task: string | KeyedTaskIdentifier | undefined;
}

export const enum DependsOrder {
	parallel = 'parallel',
	sequence = 'sequence'
}

export interface IConfigurationProperties {

	name?: string;

	identifier?: string;

	group?: string | TaskGroup;

	presentation?: IPresentationOptions;

	options?: CommandOptions;

	isBackground?: boolean;

	promptOnClose?: boolean;

	dependsOn?: ITaskDependency[];

	dependsOrder?: DependsOrder;

	detail?: string;

	problemMatchers?: Array<string | ProblemMatcher>;

	icon?: { id?: string; color?: string };

	hide?: boolean;

	inAgents?: boolean;
}

export enum RunOnOptions {
	default = 1,
	folderOpen = 2,
	worktreeCreated = 3
}

export const enum InstancePolicy {
	terminateNewest = 'terminateNewest',
	terminateOldest = 'terminateOldest',
	prompt = 'prompt',
	warn = 'warn',
	silent = 'silent'
}

export interface IRunOptions {
	reevaluateOnRerun?: boolean;
	runOn?: RunOnOptions;
	instanceLimit?: number;
	instancePolicy?: InstancePolicy;
}

export namespace RunOptions {
	export const defaults: IRunOptions = { reevaluateOnRerun: true, runOn: RunOnOptions.default, instanceLimit: 1, instancePolicy: InstancePolicy.prompt };
}

export abstract class CommonTask {

	readonly _id: string;

	_label: string = '';

	type?: string;

	runOptions: IRunOptions;

	configurationProperties: IConfigurationProperties;

	_source: IBaseTaskSource;

	private _taskLoadMessages: string[] | undefined;

	protected constructor(id: string, label: string | undefined, type: string | undefined, runOptions: IRunOptions,
		configurationProperties: IConfigurationProperties, source: IBaseTaskSource) {
		this._id = id;
		if (label) {
			this._label = label;
		}
		if (type) {
			this.type = type;
		}
		this.runOptions = runOptions;
		this.configurationProperties = configurationProperties;
		this._source = source;
	}

	public getDefinition(useSource?: boolean): KeyedTaskIdentifier | undefined {
		return undefined;
	}

	public getMapKey(): string {
		return this._id;
	}

	public getKey(): string | undefined {
		return undefined;
	}

	protected abstract getFolderId(): string | undefined;

	public getCommonTaskId(): string {
		interface IRecentTaskKey {
			folder: string | undefined;
			id: string;
		}

		const key: IRecentTaskKey = { folder: this.getFolderId(), id: this._id };
		return JSON.stringify(key);
	}

	public clone(): Task {
		return this.fromObject(Object.assign({}, this as unknown as Record<string, unknown>));
	}

	protected abstract fromObject(object: Record<string, unknown>): Task;

	public getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return undefined;
	}

	public getWorkspaceFileName(): string | undefined {
		return undefined;
	}

	public getTelemetryKind(): string {
		return 'unknown';
	}

	public matches(key: string | KeyedTaskIdentifier | undefined, compareId: boolean = false): boolean {
		if (key === undefined) {
			return false;
		}
		if (Types.isString(key)) {
			return key === this._label || key === this.configurationProperties.identifier || (compareId && key === this._id);
		}
		const identifier = this.getDefinition(true);
		return identifier !== undefined && identifier._key === key._key;
	}

	public getQualifiedLabel(): string {
		const workspaceFolder = this.getWorkspaceFolder();
		if (workspaceFolder) {
			return `${this._label} (${workspaceFolder.name})`;
		} else {
			return this._label;
		}
	}

	public getTaskExecution(): ITaskExecution {
		const result: ITaskExecution = {
			id: this._id,
			task: this as unknown as Task
		};
		return result;
	}

	public addTaskLoadMessages(messages: string[] | undefined) {
		if (this._taskLoadMessages === undefined) {
			this._taskLoadMessages = [];
		}
		if (messages) {
			this._taskLoadMessages = this._taskLoadMessages.concat(messages);
		}
	}

	get taskLoadMessages(): string[] | undefined {
		return this._taskLoadMessages;
	}
}

export class CustomTask extends CommonTask {

	declare type: '$customized';

	instance: number | undefined;

	override _source: FileBasedTaskSource;

	hasDefinedMatchers: boolean;

	command: ICommandConfiguration = {};

	public constructor(id: string, source: FileBasedTaskSource, label: string, type: string, command: ICommandConfiguration | undefined,
		hasDefinedMatchers: boolean, runOptions: IRunOptions, configurationProperties: IConfigurationProperties) {
		super(id, label, undefined, runOptions, configurationProperties, source);
		this._source = source;
		this.hasDefinedMatchers = hasDefinedMatchers;
		if (command) {
			this.command = command;
		}
	}

	public override clone(): CustomTask {
		return new CustomTask(this._id, this._source, this._label, this.type, this.command, this.hasDefinedMatchers, this.runOptions, this.configurationProperties);
	}

	public customizes(): KeyedTaskIdentifier | undefined {
		if (this._source && this._source.customizes) {
			return this._source.customizes;
		}
		return undefined;
	}

	public override getDefinition(useSource: boolean = false): KeyedTaskIdentifier {
		if (useSource && this._source.customizes !== undefined) {
			return this._source.customizes;
		} else {
			let type: string;
			const commandRuntime = this.command ? this.command.runtime : undefined;
			switch (commandRuntime) {
				case RuntimeType.Shell:
					type = 'shell';
					break;

				case RuntimeType.Process:
					type = 'process';
					break;

				case RuntimeType.CustomExecution:
					type = 'customExecution';
					break;

				case undefined:
					type = '$composite';
					break;

				default:
					throw new Error('Unexpected task runtime');
			}

			const result: KeyedTaskIdentifier = {
				type,
				_key: this._id,
				id: this._id
			};
			return result;
		}
	}

	public static is(value: unknown): value is CustomTask {
		return value instanceof CustomTask;
	}

	public override getMapKey(): string {
		const workspaceFolder = this._source.config.workspaceFolder;
		return workspaceFolder ? `${workspaceFolder.uri.toString()}|${this._id}|${this.instance}` : `${this._id}|${this.instance}`;
	}

	protected getFolderId(): string | undefined {
		return this._source.kind === TaskSourceKind.User ? USER_TASKS_GROUP_KEY : this._source.config.workspaceFolder?.uri.toString();
	}

	public override getCommonTaskId(): string {
		return this._source.customizes ? super.getCommonTaskId() : (this.getKey() ?? super.getCommonTaskId());
	}

	public override getKey(): string | undefined {
		interface ICustomKey {
			type: string;
			folder: string;
			id: string;
		}
		const workspaceFolder = this.getFolderId();
		if (!workspaceFolder) {
			return undefined;
		}
		let id: string = this.configurationProperties.identifier!;
		if (this._source.kind !== TaskSourceKind.Workspace) {
			id += this._source.kind;
		}
		const key: ICustomKey = { type: CUSTOMIZED_TASK_TYPE, folder: workspaceFolder, id };
		return JSON.stringify(key);
	}

	public override getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return this._source.config.workspaceFolder;
	}

	public override getWorkspaceFileName(): string | undefined {
		return (this._source.config.workspace && this._source.config.workspace.configuration) ? resources.basename(this._source.config.workspace.configuration) : undefined;
	}

	public override getTelemetryKind(): string {
		if (this._source.customizes) {
			return 'workspace>extension';
		} else {
			return 'workspace';
		}
	}

	protected fromObject(object: Record<string, unknown>): CustomTask {
		const obj = object as unknown as CustomTask;
		return new CustomTask(obj._id, obj._source, obj._label, obj.type, obj.command, obj.hasDefinedMatchers, obj.runOptions, obj.configurationProperties);
	}
}

export class ConfiguringTask extends CommonTask {

	override _source: FileBasedTaskSource;

	configures: KeyedTaskIdentifier;

	public constructor(id: string, source: FileBasedTaskSource, label: string | undefined, type: string | undefined,
		configures: KeyedTaskIdentifier, runOptions: IRunOptions, configurationProperties: IConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this._source = source;
		this.configures = configures;
	}

	public static is(value: unknown): value is ConfiguringTask {
		return value instanceof ConfiguringTask;
	}

	protected fromObject(object: Record<string, unknown>): Task {
		return object as unknown as Task;
	}

	public override getDefinition(): KeyedTaskIdentifier {
		return this.configures;
	}

	public override getWorkspaceFileName(): string | undefined {
		return (this._source.config.workspace && this._source.config.workspace.configuration) ? resources.basename(this._source.config.workspace.configuration) : undefined;
	}

	public override getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return this._source.config.workspaceFolder;
	}

	protected getFolderId(): string | undefined {
		return this._source.kind === TaskSourceKind.User ? USER_TASKS_GROUP_KEY : this._source.config.workspaceFolder?.uri.toString();
	}

	public override getKey(): string | undefined {
		interface ICustomKey {
			type: string;
			folder: string;
			id: string;
		}
		const workspaceFolder = this.getFolderId();
		if (!workspaceFolder) {
			return undefined;
		}
		let id: string = this.configurationProperties.identifier!;
		if (this._source.kind !== TaskSourceKind.Workspace) {
			id += this._source.kind;
		}
		const key: ICustomKey = { type: CUSTOMIZED_TASK_TYPE, folder: workspaceFolder, id };
		return JSON.stringify(key);
	}
}

export class ContributedTask extends CommonTask {

	declare _source: IExtensionTaskSource;

	instance: number | undefined;

	defines: KeyedTaskIdentifier;

	hasDefinedMatchers: boolean;

	command: ICommandConfiguration;

	icon: { id?: string; color?: string } | undefined;

	hide?: boolean;

	public constructor(id: string, source: IExtensionTaskSource, label: string, type: string | undefined, defines: KeyedTaskIdentifier,
		command: ICommandConfiguration, hasDefinedMatchers: boolean, runOptions: IRunOptions,
		configurationProperties: IConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this.defines = defines;
		this.hasDefinedMatchers = hasDefinedMatchers;
		this.command = command;
		this.icon = configurationProperties.icon;
		this.hide = configurationProperties.hide;
	}

	public override clone(): ContributedTask {
		return new ContributedTask(this._id, this._source, this._label, this.type, this.defines, this.command, this.hasDefinedMatchers, this.runOptions, this.configurationProperties);
	}

	public override getDefinition(): KeyedTaskIdentifier {
		return this.defines;
	}

	public static is(value: unknown): value is ContributedTask {
		return value instanceof ContributedTask;
	}

	public override getMapKey(): string {
		const workspaceFolder = this._source.workspaceFolder;
		return workspaceFolder
			? `${this._source.scope.toString()}|${workspaceFolder.uri.toString()}|${this._id}|${this.instance}`
			: `${this._source.scope.toString()}|${this._id}|${this.instance}`;
	}

	protected getFolderId(): string | undefined {
		if (this._source.scope === TaskScope.Folder && this._source.workspaceFolder) {
			return this._source.workspaceFolder.uri.toString();
		}
		return undefined;
	}

	public override getKey(): string | undefined {
		interface IContributedKey {
			type: string;
			scope: number;
			folder?: string;
			id: string;
		}

		const key: IContributedKey = { type: 'contributed', scope: this._source.scope, id: this._id };
		key.folder = this.getFolderId();
		return JSON.stringify(key);
	}

	public override getWorkspaceFolder(): IWorkspaceFolder | undefined {
		return this._source.workspaceFolder;
	}

	public override getTelemetryKind(): string {
		return 'extension';
	}

	protected fromObject(object: Record<string, unknown>): ContributedTask {
		const obj = object as unknown as ContributedTask;
		return new ContributedTask(obj._id, obj._source, obj._label, obj.type, obj.defines, obj.command, obj.hasDefinedMatchers, obj.runOptions, obj.configurationProperties);
	}
}

export class InMemoryTask extends CommonTask {
	override _source: IInMemoryTaskSource;

	instance: number | undefined;

	declare type: 'inMemory';

	public constructor(id: string, source: IInMemoryTaskSource, label: string, type: string,
		runOptions: IRunOptions, configurationProperties: IConfigurationProperties) {
		super(id, label, type, runOptions, configurationProperties, source);
		this._source = source;
	}

	public override clone(): InMemoryTask {
		return new InMemoryTask(this._id, this._source, this._label, this.type, this.runOptions, this.configurationProperties);
	}

	public static is(value: unknown): value is InMemoryTask {
		return value instanceof InMemoryTask;
	}

	public override getTelemetryKind(): string {
		return 'composite';
	}

	public override getMapKey(): string {
		return `${this._id}|${this.instance}`;
	}

	protected getFolderId(): undefined {
		return undefined;
	}

	protected fromObject(object: Record<string, unknown>): InMemoryTask {
		const obj = object as unknown as InMemoryTask;
		return new InMemoryTask(obj._id, obj._source, obj._label, obj.type, obj.runOptions, obj.configurationProperties);
	}
}

export type Task = CustomTask | ContributedTask | InMemoryTask;

export interface ITaskExecution {
	id: string;
	task: Task;
}

export enum ExecutionEngine {
	Process = 1,
	Terminal = 2
}

export namespace ExecutionEngine {
	export const _default: ExecutionEngine = ExecutionEngine.Terminal;
}

export const enum JsonSchemaVersion {
	V0_1_0 = 1,
	V2_0_0 = 2
}

export interface ITaskSet {
	tasks: Task[];
	extension?: IExtensionDescription;
}

export interface ITaskDefinition {
	extensionId: string;
	taskType: string;
	required: string[];
	properties: IJSONSchemaMap;
	when?: ContextKeyExpression;
}

export class TaskSorter {

	private _order: Map<string, number> = new Map();

	constructor(workspaceFolders: IWorkspaceFolder[]) {
		for (let i = 0; i < workspaceFolders.length; i++) {
			this._order.set(workspaceFolders[i].uri.toString(), i);
		}
	}

	public compare(a: Task | ConfiguringTask, b: Task | ConfiguringTask): number {
		const aw = a.getWorkspaceFolder();
		const bw = b.getWorkspaceFolder();
		if (aw && bw) {
			let ai = this._order.get(aw.uri.toString());
			ai = ai === undefined ? 0 : ai + 1;
			let bi = this._order.get(bw.uri.toString());
			bi = bi === undefined ? 0 : bi + 1;
			if (ai === bi) {
				return a._label.localeCompare(b._label);
			} else {
				return ai - bi;
			}
		} else if (!aw && bw) {
			return -1;
		} else if (aw && !bw) {
			return +1;
		} else {
			return 0;
		}
	}
}



export const enum TaskRunType {
	SingleRun = 'singleRun',
	Background = 'background'
}

export interface ITaskChangedEvent {
	kind: TaskEventKind.Changed;
}



export enum TaskEventKind {
	Changed = 'changed',

	ProcessStarted = 'processStarted',

	ProcessEnded = 'processEnded',

	Terminated = 'terminated',

	Start = 'start',

	AcquiredInput = 'acquiredInput',

	DependsOnStarted = 'dependsOnStarted',

	Active = 'active',

	Inactive = 'inactive',

	End = 'end',

	ProblemMatcherStarted = 'problemMatcherStarted',

	ProblemMatcherEnded = 'problemMatcherEnded',

	ProblemMatcherFoundErrors = 'problemMatcherFoundErrors'
}

interface ITaskCommon {
	taskId: string;
	runType: TaskRunType;
	taskName: string | undefined;
	group: string | TaskGroup | undefined;
	__task: Task;
}

export interface ITaskProcessStartedEvent extends ITaskCommon {
	kind: TaskEventKind.ProcessStarted;
	terminalId: number;
	processId: number;
}

export interface ITaskProcessEndedEvent extends ITaskCommon {
	kind: TaskEventKind.ProcessEnded;
	terminalId: number | undefined;
	exitCode?: number;
	durationMs?: number;
}

export interface ITaskInactiveEvent extends ITaskCommon {
	kind: TaskEventKind.Inactive;
	terminalId: number | undefined;
	durationMs: number | undefined;
}

export interface ITaskTerminatedEvent extends ITaskCommon {
	kind: TaskEventKind.Terminated;
	terminalId: number;
	exitReason: TerminalExitReason | undefined;
}

export interface ITaskStartedEvent extends ITaskCommon {
	kind: TaskEventKind.Start;
	terminalId: number;
	resolvedVariables: Map<string, string>;
}

export interface ITaskProblemMatcherEndedEvent extends ITaskCommon {
	kind: TaskEventKind.ProblemMatcherEnded;
	hasErrors: boolean;
}

export interface ITaskGeneralEvent extends ITaskCommon {
	kind: TaskEventKind.AcquiredInput | TaskEventKind.DependsOnStarted | TaskEventKind.Active | TaskEventKind.Inactive | TaskEventKind.End | TaskEventKind.ProblemMatcherStarted | TaskEventKind.ProblemMatcherFoundErrors;
	terminalId: number | undefined;
}

export type ITaskEvent =
	| ITaskChangedEvent
	| ITaskProcessStartedEvent
	| ITaskProcessEndedEvent
	| ITaskTerminatedEvent
	| ITaskStartedEvent
	| ITaskGeneralEvent
	| ITaskProblemMatcherEndedEvent;

export const enum TaskRunSource {
	System,
	User,
	FolderOpen,
	ConfigurationChange,
	Reconnect,
	ChatAgent
}

export namespace TaskEvent {
	function common(task: Task): ITaskCommon {
		return {
			taskId: task._id,
			taskName: task.configurationProperties.name,
			runType: task.configurationProperties.isBackground ? TaskRunType.Background : TaskRunType.SingleRun,
			group: task.configurationProperties.group,
			__task: task,
		};
	}

	export function start(task: Task, terminalId: number, resolvedVariables: Map<string, string>): ITaskStartedEvent {
		return {
			...common(task),
			kind: TaskEventKind.Start,
			terminalId,
			resolvedVariables,
		};
	}

	export function processStarted(task: Task, terminalId: number, processId: number): ITaskProcessStartedEvent {
		return {
			...common(task),
			kind: TaskEventKind.ProcessStarted,
			terminalId,
			processId,
		};
	}
	export function processEnded(task: Task, terminalId: number | undefined, exitCode: number | undefined, durationMs?: number): ITaskProcessEndedEvent {
		return {
			...common(task),
			kind: TaskEventKind.ProcessEnded,
			terminalId,
			exitCode,
			durationMs,
		};
	}

	export function inactive(task: Task, terminalId?: number, durationMs?: number): ITaskInactiveEvent {
		return {
			...common(task),
			kind: TaskEventKind.Inactive,
			terminalId,
			durationMs,
		};
	}

	export function terminated(task: Task, terminalId: number, exitReason: TerminalExitReason | undefined): ITaskTerminatedEvent {
		return {
			...common(task),
			kind: TaskEventKind.Terminated,
			exitReason,
			terminalId,
		};
	}

	export function general(kind: TaskEventKind.AcquiredInput | TaskEventKind.DependsOnStarted | TaskEventKind.Active | TaskEventKind.Inactive | TaskEventKind.End | TaskEventKind.ProblemMatcherStarted | TaskEventKind.ProblemMatcherFoundErrors, task: Task, terminalId?: number): ITaskGeneralEvent {
		return {
			...common(task),
			kind,
			terminalId,
		};
	}

	export function problemMatcherEnded(task: Task, hasErrors: boolean, terminalId?: number): ITaskProblemMatcherEndedEvent {
		return {
			...common(task),
			kind: TaskEventKind.ProblemMatcherEnded,
			hasErrors,
		};
	}

	export function changed(): ITaskChangedEvent {
		return { kind: TaskEventKind.Changed };
	}
}

export namespace KeyedTaskIdentifier {
	function sortedStringify(literal: Record<string, unknown>): string {
		const keys = Object.keys(literal).sort();
		let result: string = '';
		for (const key of keys) {
			let stringified = literal[key];
			if (stringified instanceof Object) {
				stringified = sortedStringify(stringified as Record<string, unknown>);
			} else if (typeof stringified === 'string') {
				stringified = stringified.replace(/,/g, ',,');
			}
			result += key + ',' + stringified + ',';
		}
		return result;
	}
	export function create(value: ITaskIdentifier): KeyedTaskIdentifier {
		const resultKey = sortedStringify(value);
		const result = { _key: resultKey, type: value.taskType as string };
		Object.assign(result, value);
		return result;
	}
}

export const enum TaskSettingId {
	AutoDetect = 'task.autoDetect',
	SaveBeforeRun = 'task.saveBeforeRun',
	ShowDecorations = 'task.showDecorations',
	ProblemMatchersNeverPrompt = 'task.problemMatchers.neverPrompt',
	SlowProviderWarning = 'task.slowProviderWarning',
	QuickOpenHistory = 'task.quickOpen.history',
	QuickOpenDetail = 'task.quickOpen.detail',
	QuickOpenSkip = 'task.quickOpen.skip',
	QuickOpenShowAll = 'task.quickOpen.showAll',
	AllowAutomaticTasks = 'task.allowAutomaticTasks',
	Reconnection = 'task.reconnection',
	VerboseLogging = 'task.verboseLogging',
	NotifyWindowOnTaskCompletion = 'task.notifyWindowOnTaskCompletion'
}

export const enum TasksSchemaProperties {
	Tasks = 'tasks',
	SuppressTaskName = 'tasks.suppressTaskName',
	Windows = 'tasks.windows',
	Osx = 'tasks.osx',
	Linux = 'tasks.linux',
	ShowOutput = 'tasks.showOutput',
	IsShellCommand = 'tasks.isShellCommand',
	ServiceTestSetting = 'tasks.service.testSetting',
}

export namespace TaskDefinition {
	export function createTaskIdentifier(external: ITaskIdentifier, reporter: { error(message: string): void }): KeyedTaskIdentifier | undefined {
		const definition = TaskDefinitionRegistry.get(external.type);
		if (definition === undefined) {
			const copy = Objects.deepClone(external);
			delete copy._key;
			return KeyedTaskIdentifier.create(copy);
		}

		const literal: { type: string;[name: string]: unknown } = Object.create(null);
		literal.type = definition.taskType;
		const required: Set<string> = new Set();
		definition.required.forEach(element => required.add(element));

		const properties = definition.properties;
		for (const property of Object.keys(properties)) {
			const value = external[property];
			if (value !== undefined && value !== null) {
				literal[property] = value;
			} else if (required.has(property)) {
				const schema = properties[property];
				if (schema.default !== undefined) {
					literal[property] = Objects.deepClone(schema.default);
				} else {
					switch (schema.type) {
						case 'boolean':
							literal[property] = false;
							break;
						case 'number':
						case 'integer':
							literal[property] = 0;
							break;
						case 'string':
							literal[property] = '';
							break;
						default:
							reporter.error(nls.localize(
								'TaskDefinition.missingRequiredProperty',
								'Error: the task identifier \'{0}\' is missing the required property \'{1}\'. The task identifier will be ignored.', JSON.stringify(external, undefined, 0), property
							));
							return undefined;
					}
				}
			}
		}
		return KeyedTaskIdentifier.create(literal);
	}
}

export const rerunTaskIcon = registerIcon('rerun-task', Codicon.refresh, nls.localize('rerunTaskIcon', 'View icon of the rerun task.'));
export const RerunForActiveTerminalCommandId = 'workbench.action.tasks.rerunForActiveTerminal';
export const RerunAllRunningTasksCommandId = 'workbench.action.tasks.rerunAllRunningTasks';
