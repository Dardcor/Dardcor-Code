/**
 * Dardcor Code - Debug Adapter Protocol Process Launcher & Transport Bridge (Task 616)
 */

import * as path from 'node:path';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { DapClient, IDapEvent, IDapLaunchOptions } from '../../modules/debug/dap-client';
import { URI } from '../../core/types/uri';

export interface IDapAdapterOptions {
	adapterPath: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	adapterType?: string;
}

export interface IDapSource {
	name?: string;
	path?: string;
	sourceReference?: number;
}

export interface IDapBreakpoint {
	id: number;
	verified: boolean;
	line?: number;
	column?: number;
	message?: string;
}

export interface IDapThread {
	id: number;
	name: string;
}

export interface IDapStackFrame {
	id: number;
	name: string;
	line: number;
	column: number;
	source?: IDapSource;
}

export interface IDapScope {
	name: string;
	variablesReference: number;
	expensive: boolean;
}

export interface IDapVariable {
	name: string;
	value: string;
	type?: string;
	variablesReference: number;
}

export interface IDapStoppedEvent {
	reason: string;
	threadId: number;
	description?: string;
	allThreadsStopped?: boolean;
}

export interface IDapAdapterEvent {
	readonly kind: 'initialized' | 'stopped' | 'continued' | 'exited' | 'terminated' | 'thread' | 'output' | 'breakpoint' | 'custom';
	readonly body?: any;
}

/**
 * High-level DAP session wrapper: launches the adapter process, performs
 * the handshake, and exposes typed convenience requests.
 */
export class DapAdapter extends Disposable {
	private readonly _client: DapClient;
	private _adapterType: string;
	private _launched = false;
	private _initialized = false;

	private readonly _onDidEvent = this._register(new Emitter<IDapAdapterEvent>());
	readonly onDidEvent: Event<IDapAdapterEvent> = this._onDidEvent.event;

	private readonly _onDidExit = this._register(new Emitter<{ code: number | null; signal: string | null }>());
	readonly onDidExit = this._onDidExit.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError = this._onDidError.event;

	public static async launch(options: IDapAdapterOptions): Promise<DapAdapter> {
		const adapter = new DapAdapter(options);
		await adapter.start();
		return adapter;
	}

	constructor(options: IDapAdapterOptions) {
		super();
		this._adapterType = options.adapterType ?? path.basename(options.adapterPath, path.extname(options.adapterPath));
		this._client = new DapClient();
		this._register(this._client);
		this._register(this._client.onDidEvent(event => this._handleClientEvent(event)));
		this._register(this._client.onDidExit(e => this._onDidExit.fire(e)));
		this._register(this._client.onDidError(err => this._onDidError.fire(err)));

		this._launchOptions = {
			command: options.adapterPath,
			args: options.args ?? [],
			cwd: options.cwd,
			env: options.env
		};
	}

	private readonly _launchOptions: IDapLaunchOptions;

	public get isRunning(): boolean {
		return this._client.isRunning;
	}

	public get adapterType(): string {
		return this._adapterType;
	}

	public async start(): Promise<void> {
		await this._client.start(this._launchOptions);
	}

	public async initialize(adapterId: string, options: { linesStartAt1?: boolean; columnsStartAt1?: boolean; pathFormat?: string } = {}): Promise<any> {
		const result = await this._client.request('initialize', {
			adapterID: adapterId,
			clientID: 'dardcor-code',
			clientName: 'Dardcor Code',
			linesStartAt1: options.linesStartAt1 ?? true,
			columnsStartAt1: options.columnsStartAt1 ?? true,
			pathFormat: options.pathFormat ?? 'path',
			supportsVariableType: true,
			supportsVariablePaging: true,
			supportsRunInTerminalRequest: true,
			supportsMemoryReferences: true,
			supportsProgressReporting: true
		});
		this._initialized = true;

		return result;
	}

	public async launchRequest(config: Record<string, any>): Promise<void> {
		await this._client.request('launch', config);
		this._launched = true;
	}

	public async attachRequest(config: Record<string, any>): Promise<void> {
		await this._client.request('attach', config);
		this._launched = true;
	}

	public async configurationDone(): Promise<void> {
		await this._client.request('configurationDone', {});
	}

	public async setBreakpoints(sourcePath: string, lines: number[]): Promise<IDapBreakpoint[]> {
		const result = await this._client.request<{ breakpoints: IDapBreakpoint[] }>('setBreakpoints', {
			source: { path: sourcePath },
			breakpoints: lines.map(line => ({ line })),
			sourceModified: false
		});
		return result?.breakpoints ?? [];
	}

	public async setExceptionBreakpoints(filter: string[]): Promise<{ breakpoints?: IDapBreakpoint[] }> {
		return this._client.request('setExceptionBreakpoints', { filters: filter });
	}

	public async continue(threadId: number): Promise<any> {
		return this._client.request('continue', { threadId });
	}

	public async next(threadId: number): Promise<void> {
		await this._client.request('next', { threadId });
	}

	public async stepIn(threadId: number): Promise<void> {
		await this._client.request('stepIn', { threadId });
	}

	public async stepOut(threadId: number): Promise<void> {
		await this._client.request('stepOut', { threadId });
	}

	public async pause(threadId: number): Promise<void> {
		await this._client.request('pause', { threadId });
	}

	public async threads(): Promise<IDapThread[]> {
		const result = await this._client.request<{ threads: IDapThread[] }>('threads', {});
		return result?.threads ?? [];
	}

	public async stackTrace(threadId: number, startFrame = 0, levels = 50): Promise<IDapStackFrame[]> {
		const result = await this._client.request<{ stackFrames: IDapStackFrame[] }>('stackTrace', {
			threadId,
			startFrame,
			levels
		});
		return result?.stackFrames ?? [];
	}

	public async scopes(frameId: number): Promise<IDapScope[]> {
		const result = await this._client.request<{ scopes: IDapScope[] }>('scopes', { frameId });
		return result?.scopes ?? [];
	}

	public async variables(variablesReference: number): Promise<IDapVariable[]> {
		const result = await this._client.request<{ variables: IDapVariable[] }>('variables', { variablesReference });
		return result?.variables ?? [];
	}

	public async evaluate(expression: string, frameId?: number, context = 'watch'): Promise<{ result: string; variablesReference: number; type?: string }> {
		return this._client.request('evaluate', {
			expression,
			frameId,
			context
		});
	}

	public async source(sourceReference: number): Promise<{ content?: string; mimeType?: string }> {
		return this._client.request('source', { sourceReference });
	}

	public async customRequest(command: string, args?: any): Promise<any> {
		return this._client.request(command, args);
	}

	public async disconnect(terminateDebuggee = true): Promise<void> {
		try {
			await this._client.request('disconnect', { terminateDebuggee });
		} catch {
			// adapter mungkin sudah berhenti
		}
		this._client.stop();
	}

	public get launchOptions(): IDapLaunchOptions {
		return { ...this._launchOptions };
	}

	private _handleClientEvent(event: IDapEvent): void {
		switch (event.event) {
			case 'initialized':
				this._initialized = true;
				this._onDidEvent.fire({ kind: 'initialized', body: event.body });
				break;
			case 'stopped':
				this._onDidEvent.fire({ kind: 'stopped', body: event.body as IDapStoppedEvent });
				break;
			case 'continued':
				this._onDidEvent.fire({ kind: 'continued', body: event.body });
				break;
			case 'exited':
				this._onDidEvent.fire({ kind: 'exited', body: event.body });
				break;
			case 'terminated':
				this._onDidEvent.fire({ kind: 'terminated', body: event.body });
				break;
			case 'thread':
				this._onDidEvent.fire({ kind: 'thread', body: event.body });
				break;
			case 'output':
				this._onDidEvent.fire({ kind: 'output', body: event.body });
				break;
			case 'breakpoint':
				this._onDidEvent.fire({ kind: 'breakpoint', body: event.body });
				break;
			default:
				this._onDidEvent.fire({ kind: 'custom', body: { event: event.event, body: event.body } });
				break;
		}
	}
}

export { URI };
