/**
 * Dardcor Code - Debug Execution Session State Controller
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { DapClient, IDapEvent } from './dap-client.js';
import { IBreakpoint } from './breakpoint-manager.js';
import { URI } from '../../core/types/uri.js';

declare const process: any;

export enum DebugState {
	Idle = 0,
	Initializing = 1,
	Running = 2,
	Stopped = 3,
	Paused = 4,
	Exited = 5
}

export interface IStackFrame {
	readonly id: number;
	readonly name: string;
	readonly sourcePath?: string;
	readonly sourceName?: string;
	readonly line: number;
	readonly column: number;
	readonly threadId: number;
}

export interface IThreadInfo {
	readonly id: number;
	readonly name: string;
}

export interface IDebugScope {
	readonly name: string;
	readonly variablesReference: number;
	readonly expensive: boolean;
}

export interface IDebugVariable {
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly variablesReference: number;
}

export interface IDebugSessionOptions {
	adapterPath: string;
	program: string;
	cwd?: string;
	args?: string[];
	env?: Record<string, string>;
}

export interface IDebugStopReason {
	reason: string;
	description?: string;
}

export class DebugSession extends Disposable {
	private readonly _onDidChangeState = this._register(new Emitter<DebugState>());
	readonly onDidChangeState: Event<DebugState> = this._onDidChangeState.event;

	private readonly _onDidStop = this._register(new Emitter<IDebugStopReason>());
	readonly onDidStop: Event<IDebugStopReason> = this._onDidStop.event;

	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	private readonly _onDidUpdateThreads = this._register(new Emitter<void>());
	readonly onDidUpdateThreads: Event<void> = this._onDidUpdateThreads.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private _state = DebugState.Idle;
	private _client = new DapClient();
	private _threads: IThreadInfo[] = [];
	private _stoppedThreadId = -1;
	private _frames: IStackFrame[] = [];
	private _breakpoints: IBreakpoint[] = [];
	private _options: IDebugSessionOptions | undefined;

	constructor() {
		super();
		this._register(this._client.onDidEvent(e => this._onEvent(e)));
		this._register(this._client.onDidExit(() => {
			this._setState(DebugState.Exited);
		}));
		this._register(this._client.onDidError(message => {
			this._onDidError.fire(message);
		}));
	}

	get state(): DebugState {
		return this._state;
	}

	get threads(): IThreadInfo[] {
		return this._threads;
	}

	get stoppedThreadId(): number {
		return this._stoppedThreadId;
	}

	get frames(): IStackFrame[] {
		return this._frames;
	}

	get currentFrameId(): number | undefined {
		return this._frames.length > 0 ? this._frames[0].id : undefined;
	}

	public async start(options: IDebugSessionOptions, breakpoints: IBreakpoint[] = []): Promise<void> {
		if (this._state === DebugState.Running || this._state === DebugState.Initializing) {
			await this.stop();
		}
		this._options = options;
		this._breakpoints = breakpoints;
		this._setState(DebugState.Initializing);
		try {
			await this._client.start({
				command: process.execPath ?? 'node',
				args: [options.adapterPath],
				cwd: options.cwd,
				env: options.env
			});
			await this._client.request('initialize', {
				adapterID: 'dc-debug',
				linesStartAt1: true,
				columnsStartAt1: true,
				pathFormat: 'path'
			});
			await this._client.request('launch', {
				program: options.program,
				args: options.args ?? [],
				cwd: options.cwd ?? undefined
			});
			await this._sendBreakpoints(breakpoints);
			await this._client.request('configurationDone');
			this._setState(DebugState.Running);
		} catch (err) {
			this._onDidError.fire(String(err));
			this._setState(DebugState.Exited);
		}
	}

	public async stop(): Promise<void> {
		try {
			await this._client.request('disconnect', { terminateDebuggee: true });
		} catch {
			// ignore
		}
		this._client.stop();
		this._frames = [];
		this._threads = [];
		this._stoppedThreadId = -1;
		this._setState(DebugState.Exited);
	}

	public async restart(options?: IDebugSessionOptions): Promise<void> {
		const opts = options ?? this._options;
		if (opts) {
			await this.start(opts, this._breakpoints);
		}
	}

	public async setBreakpoints(breakpoints: IBreakpoint[]): Promise<void> {
		this._breakpoints = breakpoints;
		if (this._state === DebugState.Running || this._state === DebugState.Stopped || this._state === DebugState.Paused) {
			await this._sendBreakpoints(breakpoints);
		}
	}

	private async _sendBreakpoints(breakpoints: IBreakpoint[]): Promise<void> {
		const byFile = new Map<string, IBreakpoint[]>();
		for (const bp of breakpoints) {
			const key = bp.resource.toString();
			let list = byFile.get(key);
			if (!list) {
				list = [];
				byFile.set(key, list);
			}
			list.push(bp);
		}
		for (const [key, list] of byFile) {
			const sourcePath = URI.parse(key).path;
			try {
				await this._client.request('setBreakpoints', {
					source: { path: sourcePath },
					breakpoints: list.map(bp => ({ line: bp.line, enabled: bp.enabled })),
					sourceModified: false
				});
			} catch (err) {
				this._onDidError.fire(`Gagal set breakpoint: ${String(err)}`);
			}
		}
	}

	public async continue(): Promise<void> {
		await this._safeRequest('continue', { threadId: this._stoppedThreadId });
		this._frames = [];
		this._stoppedThreadId = -1;
		this._setState(DebugState.Running);
	}

	public async next(): Promise<void> {
		await this._safeRequest('next', { threadId: this._stoppedThreadId });
		this._setState(DebugState.Running);
	}

	public async stepIn(): Promise<void> {
		await this._safeRequest('stepIn', { threadId: this._stoppedThreadId });
		this._setState(DebugState.Running);
	}

	public async stepOut(): Promise<void> {
		await this._safeRequest('stepOut', { threadId: this._stoppedThreadId });
		this._setState(DebugState.Running);
	}

	public async pause(): Promise<void> {
		if (this._threads.length > 0) {
			await this._safeRequest('pause', { threadId: this._threads[0].id });
		}
	}

	public async getStackFrames(threadId: number): Promise<IStackFrame[]> {
		const body = await this._client.request<{ stackFrames?: any[] }>('stackTrace', { threadId, levels: 50 });
		const frames = (body?.stackFrames ?? []).map(frame => ({
			id: frame.id,
			name: frame.name,
			sourcePath: frame.source?.path,
			sourceName: frame.source?.name,
			line: frame.line ?? 0,
			column: frame.column ?? 0,
			threadId
		}));
		this._frames = frames;
		return frames;
	}

	public async getScopes(frameId: number): Promise<IDebugScope[]> {
		const body = await this._client.request<{ scopes?: IDebugScope[] }>('scopes', { frameId });
		return (body?.scopes ?? []).map(scope => ({
			name: scope.name,
			variablesReference: scope.variablesReference,
			expensive: !!scope.expensive
		}));
	}

	public async getVariables(variablesReference: number): Promise<IDebugVariable[]> {
		if (variablesReference <= 0) {
			return [];
		}
		const body = await this._client.request<{ variables?: IDebugVariable[] }>('variables', { variablesReference });
		return (body?.variables ?? []).map(v => ({
			name: v.name,
			value: v.value,
			type: v.type,
			variablesReference: v.variablesReference
		}));
	}

	public async evaluate(expression: string, frameId?: number): Promise<{ result: string; type?: string }> {
		const body = await this._client.request<{ result: string; type?: string }>('evaluate', {
			expression,
			frameId: frameId ?? this.currentFrameId ?? 0,
			context: 'watch'
		});
		return { result: body?.result ?? '', type: body?.type };
	}

	private async _safeRequest(command: string, args: any): Promise<void> {
		try {
			await this._client.request(command, args);
		} catch (err) {
			this._onDidError.fire(String(err));
		}
	}

	private async _onEvent(e: IDapEvent): Promise<void> {
		switch (e.event) {
			case 'initialized':
				break;
			case 'stopped': {
				const threadId = e.body?.threadId ?? -1;
				this._stoppedThreadId = threadId;
				const reason = e.body?.reason ?? 'unknown';
				this._setState(DebugState.Stopped);
				if (threadId >= 0) {
					try {
						await this.getStackFrames(threadId);
					} catch {
						// ignore
					}
				}
				this._onDidStop.fire({ reason, description: e.body?.description });
				break;
			}
			case 'continued':
				this._setState(DebugState.Running);
				break;
			case 'thread': {
				const body = await this._client.request<{ threads?: IThreadInfo[] }>('threads');
				this._threads = body?.threads ?? [];
				this._onDidUpdateThreads.fire();
				break;
			}
			case 'output':
				this._onDidOutput.fire(e.body?.output ?? '');
				break;
			case 'terminated':
			case 'exited':
				this._setState(DebugState.Exited);
				break;
			default:
				break;
		}
	}

	private _setState(state: DebugState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeState.fire(state);
		}
	}
}
