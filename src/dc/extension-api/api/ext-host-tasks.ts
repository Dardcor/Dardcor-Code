/**
 * Dardcor Code - dc.tasks API Bridge (Task 623)
 * Mirrors: vs/workbench/api/common/extHostTasks.ts
 */

import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol.js';
import { URI } from '../../core/types/uri.js';
import { CancellationToken } from '../../core/async/cancellation.js';

export type Thenable<T> = PromiseLike<T>;

export enum TaskScope {
	Global = 1,
	Workspace = 2
}

export interface TaskDefinition {
	readonly type: string;
	readonly [key: string]: any;
}

export interface TaskSource {
	readonly label: string;
	readonly uri?: URI;
}

export interface TaskGroup {
	readonly id: string;
	readonly isDefault?: boolean;
}

export namespace TaskGroup {
	export const Build: TaskGroup = { id: 'build' };
	export const Clean: TaskGroup = { id: 'clean' };
	export const Rebuild: TaskGroup = { id: 'rebuild' };
	export const Test: TaskGroup = { id: 'test' };
}

export interface TaskOptions {
	cwd?: string;
	env?: Record<string, string>;
	presentation?: Record<string, unknown>;
}

export class Task {
	constructor(
		public readonly definition: TaskDefinition,
		public readonly scope: TaskScope | URI,
		public readonly name: string,
		public readonly source: TaskSource,
		public readonly execution?: { command: string; args?: string[]; options?: TaskOptions } | { commandLine: string; options?: TaskOptions },
		public readonly group?: TaskGroup
	) {}

	public toJSON(): any {
		const scope = this.scope instanceof URI ? { uri: this.scope.toString() } : { scope: this.scope };
		return {
			definition: this.definition,
			name: this.name,
			source: { label: this.source.label, uri: this.source.uri?.toString() },
			...scope,
			execution: this.execution ?? undefined,
			group: this.group ?? undefined
		};
	}
}

export class TaskExecution {
	constructor(
		public readonly task: Task,
		public readonly id: number
	) {}
}

export interface TaskProvider {
	provideTasks(token?: CancellationToken): Task[] | undefined | null | Thenable<Task[] | undefined | null>;
	resolveTask?(task: Task, token?: CancellationToken): Task | undefined | null | Thenable<Task | undefined | null>;
}

export interface TaskFilter {
	version?: string;
	type?: string;
}

export interface ITasksApi {
	registerTaskProvider(type: string, provider: TaskProvider): IDisposable;
	fetchTasks(filter?: TaskFilter): Promise<Task[]>;
	executeTask(task: Task): Promise<TaskExecution>;
	readonly taskExecutions: readonly TaskExecution[];
	readonly onDidStartTask: Event<TaskExecution>;
	readonly onDidEndTask: Event<TaskExecution>;
	readonly onDidStartTaskProcess: Event<{ execution: TaskExecution; processId: number }>;
	readonly onDidEndTaskProcess: Event<{ execution: TaskExecution; exitCode: number | undefined }>;
}

/**
 * Task bridge. Task providers run here; task execution is delegated to
 * the main side (shell runner).
 */
export class ExtHostTasks extends Disposable {
	private _nextProviderId = 1;
	private readonly _providers = new Map<number, { type: string; provider: TaskProvider }>();
	private readonly _executions = new Map<number, TaskExecution>();

	private readonly _onDidStartTask = this._register(new Emitter<TaskExecution>());
	readonly onDidStartTask: Event<TaskExecution> = this._onDidStartTask.event;

	private readonly _onDidEndTask = this._register(new Emitter<TaskExecution>());
	readonly onDidEndTask: Event<TaskExecution> = this._onDidEndTask.event;

	private readonly _onDidStartTaskProcess = this._register(new Emitter<{ execution: TaskExecution; processId: number }>());
	readonly onDidStartTaskProcess: Event<{ execution: TaskExecution; processId: number }> = this._onDidStartTaskProcess.event;

	private readonly _onDidEndTaskProcess = this._register(new Emitter<{ execution: TaskExecution; exitCode: number | undefined }>());
	readonly onDidEndTaskProcess: Event<{ execution: TaskExecution; exitCode: number | undefined }> = this._onDidEndTaskProcess.event;

	constructor(private readonly _rpc: RPCProtocol) {
		super();
		this._register(this._rpc.onEvent('tasks', 'started')((payload: { executionId: number; task: any }) => {
			const execution = this._executions.get(payload.executionId);
			if (execution) {
				this._onDidStartTask.fire(execution);
			}
		}));
		this._register(this._rpc.onEvent('tasks', 'ended')((payload: { executionId: number; exitCode?: number }) => {
			const execution = this._executions.get(payload.executionId);
			if (execution) {
				this._executions.delete(payload.executionId);
				this._onDidEndTask.fire(execution);
				this._onDidEndTaskProcess.fire({ execution, exitCode: payload.exitCode });
			}
		}));
	}

	public registerTaskProvider(type: string, provider: TaskProvider): IDisposable {
		const id = this._nextProviderId++;
		this._providers.set(id, { type, provider });
		this._rpc.notify('main', 'tasks.registerProvider', { id, type });
		return toDisposable(() => this._providers.delete(id));
	}

	public fetchTasks(filter?: TaskFilter): Promise<Task[]> {
		return this._rpc.call<any[]>('main', 'tasks.fetchTasks', { filter }).then(list => (list ?? []).map(t => this._taskFromJSON(t)));
	}

	public async executeTask(task: Task): Promise<TaskExecution> {
		const executionId = await this._rpc.call<number>('main', 'tasks.execute', { task: task.toJSON() });
		const execution = new TaskExecution(task, executionId);
		this._executions.set(executionId, execution);
		return execution;
	}

	public get api(): ITasksApi {
		const self = this;
		return {
			registerTaskProvider: (type: string, provider: TaskProvider) => this.registerTaskProvider(type, provider),
			fetchTasks: (filter?: TaskFilter) => this.fetchTasks(filter),
			executeTask: (task: Task) => this.executeTask(task),
			get taskExecutions() {
				return [...self._executions.values()];
			},
			onDidStartTask: this.onDidStartTask,
			onDidEndTask: this.onDidEndTask,
			onDidStartTaskProcess: this.onDidStartTaskProcess,
			onDidEndTaskProcess: this.onDidEndTaskProcess
		};
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$fetchTasks': {
						const registration = [...this._providers.values()].find(r => r.type === payload.type);
						if (!registration?.provider.provideTasks) {
							return [];
						}
						return Promise.resolve(registration.provider.provideTasks(CancellationToken.None)).then(tasks => (tasks ?? []).map((t: any) => t.toJSON()));
					}
					case '$resolveTask': {
						const registration = [...this._providers.values()].find(r => r.type === payload.type);
						if (!registration?.provider.resolveTask) {
							return payload.task;
						}
						return Promise.resolve(registration.provider.resolveTask(this._taskFromJSON(payload.task))).then(t => t?.toJSON() ?? payload.task);
					}
					default:
						throw new Error(`Perintah tasks tidak dikenal: ${command}`);
				}
			}
		};
	}

	private _taskFromJSON(json: any): Task {
		const scope = json.scope !== undefined ? (json.scope as TaskScope) : (json.uri ? URI.parse(json.uri) : TaskScope.Workspace);
		return new Task(
			json.definition,
			json.uri ? URI.parse(json.uri) : scope,
			json.name,
			{ label: json.source?.label ?? 'Extension', uri: json.source?.uri ? URI.parse(json.source.uri) : undefined },
			json.execution,
			json.group
		);
	}
}
