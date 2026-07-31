import { Disposable, toDisposable } from '../../core/lifecycle/disposable';
import { Emitter } from '../../core/events/emitter';
import { UtilityProcessRpc } from './utility-process-rpc';

export interface UtilityProcessEntry {
	id: number;
	serviceName: string;
	pid: number | null;
	child: any;
	port: unknown;
	rpc: UtilityProcessRpc;
	startedAt: number;
}

export interface UtilityProcessOptions {
	serviceName: string;
	args?: string[];
	env?: Record<string, string>;
	execArgv?: string[];
	stdout?: boolean;
	stderr?: boolean;
}

export interface UtilityProcessExitInfo {
	serviceName: string;
	code: number;
	signal?: string;
}

export class UtilityProcessManager extends Disposable {
	private readonly _processes = new Map<string, UtilityProcessEntry>();
	private _nextId = 1;
	private readonly _onDidExit = new Emitter<UtilityProcessExitInfo>();
	public readonly onDidExit = this._onDidExit.event;

	constructor() {
		super();
		this._register(this._onDidExit);
		this._register(toDisposable(() => this.killAll()));
	}

	public async spawn(scriptPath: string, options: UtilityProcessOptions): Promise<UtilityProcessEntry | null> {
		try {
			const electron = await import('electron');
			const utilityProcess = (electron as any).utilityProcess;
			const { MessageChannelMain } = electron as any;
			if (!utilityProcess) {
				console.error('[utility-process-manager] utilityProcess unavailable');
				return null;
			}
			const child = utilityProcess.fork(scriptPath, options.args ?? [], {
				serviceName: options.serviceName,
				env: options.env,
				execArgv: options.execArgv,
				stdout: options.stdout ?? false ? 'pipe' : 'ignore',
				stderr: options.stderr ?? false ? 'pipe' : 'ignore'
			});
			const entry: UtilityProcessEntry = {
				id: this._nextId++,
				serviceName: options.serviceName,
				pid: child.pid,
				child,
				port: null,
				rpc: new UtilityProcessRpc(),
				startedAt: Date.now()
			};

			if (MessageChannelMain) {
				const { port1, port2 } = new MessageChannelMain();
				child.postMessage({ __dcChannelInit: true }, [port2]);
				port1.start();
				entry.port = port1;
				entry.rpc.expose(port1);
			}

			if (options.stdout && child.stdout) {
				child.stdout.on('data', (data: Buffer) => process.stdout.write(`[${options.serviceName}] ${data.toString()}`));
			}
			if (options.stderr && child.stderr) {
				child.stderr.on('data', (data: Buffer) => process.stderr.write(`[${options.serviceName}] ${data.toString()}`));
			}

			child.on('exit', (code: number, signal?: string) => {
				this._processes.delete(options.serviceName);
				this._onDidExit.fire({ serviceName: options.serviceName, code, signal });
			});
			child.on('error', (err: unknown) => {
				console.error(`[utility-process-manager] '${options.serviceName}' error:`, err);
			});

			this._processes.set(options.serviceName, entry);
			return entry;
		} catch (err) {
			console.error('[utility-process-manager] spawn failed:', err);
			return null;
		}
	}

	public get(serviceName: string): UtilityProcessEntry | null {
		return this._processes.get(serviceName) ?? null;
	}

	public isAlive(serviceName: string): boolean {
		const entry = this._processes.get(serviceName);
		return !!entry && !!entry.child && !entry.child.killed;
	}

	public getServiceNames(): string[] {
		return [...this._processes.keys()];
	}

	public getEntries(): UtilityProcessEntry[] {
		return [...this._processes.values()];
	}

	public getPid(serviceName: string): number | null {
		return this._processes.get(serviceName)?.pid ?? null;
	}

	public call<T = unknown>(serviceName: string, method: string, ...args: unknown[]): Promise<T> {
		const entry = this._processes.get(serviceName);
		if (!entry) {
			return Promise.reject(new Error(`Utility process '${serviceName}' not found`));
		}
		if (!entry.port) {
			return Promise.reject(new Error(`Utility process '${serviceName}' has no channel`));
		}
		return entry.rpc.call(entry.port as any, method, args) as Promise<T>;
	}

	public kill(serviceName: string, signal?: string): boolean {
		const entry = this._processes.get(serviceName);
		if (!entry?.child) {
			return false;
		}
		try {
			entry.child.kill(signal);
			return true;
		} catch {
			return false;
		}
	}

	public killAll(signal?: string): void {
		for (const serviceName of [...this._processes.keys()]) {
			this.kill(serviceName, signal);
		}
	}

	public restart(serviceName: string, scriptPath: string, options: UtilityProcessOptions): Promise<UtilityProcessEntry | null> {
		this.kill(serviceName);
		this._processes.delete(serviceName);
		return this.spawn(scriptPath, options);
	}

	public override dispose(): void {
		this.killAll();
		super.dispose();
	}
}

export function createUtilityProcessManager(): UtilityProcessManager {
	return new UtilityProcessManager();
}
