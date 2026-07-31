import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

export interface IExtensionDebuggerOptions {
	readonly port?: number;
	readonly breakOnStart?: boolean;
	readonly host?: string;
	readonly args?: string[];
	readonly env?: Record<string, string>;
}

export interface IExtensionDebuggerLaunchInfo {
	readonly pid: number | undefined;
	readonly port: number;
	readonly inspectFlag: string;
	readonly command: string;
}

export const DEFAULT_DEBUG_PORT = 9339;

export class RemoteExtensionDebugger extends Disposable {
	private _child: ChildProcess | null = null;
	private _port: number | null = null;

	private readonly _onDidLaunch = this._register(new Emitter<IExtensionDebuggerLaunchInfo>());
	readonly onDidLaunch: Event<IExtensionDebuggerLaunchInfo> = this._onDidLaunch.event;

	private readonly _onDidStop = this._register(new Emitter<{ code: number | null; signal: string | null }>());
	readonly onDidStop: Event<{ code: number | null; signal: string | null }> = this._onDidStop.event;

	private readonly _onDidOutput = this._register(new Emitter<string>());
	readonly onDidOutput: Event<string> = this._onDidOutput.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(private readonly _nodePath: string = process.execPath) {
		super();
	}

	get isRunning(): boolean {
		return this._child !== null && this._child.exitCode === null;
	}

	get pid(): number | undefined {
		return this._child?.pid;
	}

	getDebugPort(): number | null {
		return this._port;
	}

	launch(extensionHostPath: string, options: IExtensionDebuggerOptions = {}): IExtensionDebuggerLaunchInfo {
		if (!existsSync(extensionHostPath)) {
			throw new Error(`Extension host entry point not found: ${extensionHostPath}`);
		}
		const port = options.port ?? DEFAULT_DEBUG_PORT;
		const inspectFlag = options.breakOnStart
			? `--inspect-brk=${options.host ?? '127.0.0.1'}:${port}`
			: `--inspect=${options.host ?? '127.0.0.1'}:${port}`;
		const args = [inspectFlag, extensionHostPath, ...(options.args ?? [])];
		const child = spawn(this._nodePath, args, {
			env: { ...process.env, ...options.env },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		this._child = child;
		this._port = port;
		this._onDidLaunch.fire({ pid: child.pid, port, inspectFlag, command: `${this._nodePath} ${args.join(' ')}` });
		child.stdout?.on('data', (chunk: Buffer) => this._onDidOutput.fire(chunk.toString('utf8')));
		child.stderr?.on('data', (chunk: Buffer) => this._onDidOutput.fire(chunk.toString('utf8')));
		child.on('error', error => this._onError.fire(error));
		child.on('exit', (code, signal) => {
			this._child = null;
			this._port = null;
			this._onDidStop.fire({ code, signal });
		});
		return { pid: child.pid, port, inspectFlag, command: args.join(' ') };
	}

	async attach(port: number): Promise<boolean> {
		if (typeof fetch === 'undefined') {
			return false;
		}
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
			if (!response.ok) {
				return false;
			}
			this._port = port;
			return true;
		} catch {
			return false;
		}
	}

	async getDebugTargets(port?: number): Promise<Array<Record<string, unknown>>> {
		const targetPort = port ?? this._port;
		if (targetPort === null || typeof fetch === 'undefined') {
			return [];
		}
		try {
			const response = await fetch(`http://127.0.0.1:${targetPort}/json/list`, { signal: AbortSignal.timeout(3000) });
			if (!response.ok) {
				return [];
			}
			const data = (await response.json()) as Array<Record<string, unknown>>;
			return Array.isArray(data) ? data : [];
		} catch {
			return [];
		}
	}

	stop(signal: NodeJS.Signals = 'SIGTERM'): boolean {
		if (!this._child || this._child.exitCode !== null) {
			return false;
		}
		try {
			return this._child.kill(signal);
		} catch {
			return false;
		}
	}

	forceStop(): boolean {
		return this.stop('SIGKILL');
	}

	async waitForExit(timeoutMs = 5000): Promise<{ code: number | null; signal: string | null }> {
		const child = this._child;
		if (!child) {
			return { code: null, signal: null };
		}
		return new Promise(resolvePromise => {
			const timer = setTimeout(() => resolvePromise({ code: child.exitCode, signal: null }), timeoutMs);
			child.once('exit', (code, signal) => {
				clearTimeout(timer);
				resolvePromise({ code, signal });
			});
		});
	}

	override dispose(): void {
		this.forceStop();
		super.dispose();
	}
}
