/**
 * Dardcor Code - Extension Host Execution Process On Remote Server (Task 805)
 */

import { fork, ChildProcess } from 'node:child_process';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IRemoteExtensionHostOptions {
	readonly entryModule: string;
	readonly workspaceRoot: string;
	readonly extensionsRoot?: string;
	readonly env?: Record<string, string>;
	readonly execArgv?: string[];
	readonly maxRestarts?: number;
}

export interface IRemoteExtensionHostExitInfo {
	readonly code: number | null;
	readonly signal: string | null;
}

export class RemoteExtensionHost extends Disposable {
	private _child: ChildProcess | null = null;
	private _exitInfo: IRemoteExtensionHostExitInfo | null = null;
	private _restartCount = 0;
	private _starting = false;

	private readonly _onDidMessage = this._register(new Emitter<any>());
	readonly onDidMessage: Event<any> = this._onDidMessage.event;

	private readonly _onDidExit = this._register(new Emitter<IRemoteExtensionHostExitInfo>());
	readonly onDidExit: Event<IRemoteExtensionHostExitInfo> = this._onDidExit.event;

	private readonly _onDidError = this._register(new Emitter<Error>());
	readonly onDidError: Event<Error> = this._onDidError.event;

	constructor(private readonly _options: IRemoteExtensionHostOptions) {
		super();
	}

	get pid(): number | undefined {
		return this._child?.pid;
	}

	get exited(): IRemoteExtensionHostExitInfo | null {
		return this._exitInfo;
	}

	get restartCount(): number {
		return this._restartCount;
	}

	start(): void {
		if (this._child || this._starting) {
			return;
		}
		this._starting = true;
		try {
			const env: Record<string, string> = {
				...(typeof process !== 'undefined' && process.env ? process.env as Record<string, string> : {}),
				...this._options.env,
				DC_REMOTE_WORKSPACE: this._options.workspaceRoot
			};
			if (this._options.extensionsRoot) {
				env.DC_REMOTE_EXTENSIONS = this._options.extensionsRoot;
			}
			const child = fork(this._options.entryModule, [], {
				cwd: this._options.workspaceRoot,
				env,
				stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
				execArgv: this._options.execArgv
			});
			this._starting = false;
			this._child = child;

			if (child.stdout) {
				child.stdout.on('data', (chunk: Buffer) => {
					this._parseLines(chunk.toString('utf8'));
				});
			}
			if (child.stderr) {
				child.stderr.on('data', (chunk: Buffer) => {
					for (const line of chunk.toString('utf8').split('\n')) {
						if (line.trim()) {
							this._onDidError.fire(new Error(`[extension-host] ${line}`));
						}
					}
				});
			}
			child.on('error', (error: NodeJS.ErrnoException) => {
				this._onDidError.fire(error.code === 'ENOENT'
					? new Error(`Extension host entry module not found: ${this._options.entryModule}`)
					: error);
			});
			child.on('exit', (code, signal) => {
				this._exitInfo = { code, signal };
				const info = this._exitInfo;
				this._child = null;
				this._onDidExit.fire(info);
				this._maybeRestart();
			});
		} catch (error) {
			this._starting = false;
			this._onDidError.fire(error instanceof Error ? error : new Error(String(error)));
		}
	}

	postMessage(message: any): void {
		if (!this._child || !this._child.stdin || this._child.stdin.destroyed) {
			return;
		}
		try {
			this._child.stdin.write(`${JSON.stringify(message)}\n`);
		} catch (error) {
			this._onDidError.fire(error instanceof Error ? error : new Error(String(error)));
		}
	}

	kill(signal: NodeJS.Signals = 'SIGTERM'): void {
		if (this._child && !this._child.killed) {
			try {
				this._child.kill(signal);
			} catch {
				// ignore
			}
		}
	}

	stop(): void {
		if (this._child) {
			this.kill('SIGKILL');
			this._child = null;
		}
	}

	restart(): void {
		this.stop();
		this._restartCount = 0;
		this._exitInfo = null;
		this.start();
	}

	private _maybeRestart(): void {
		const maxRestarts = this._options.maxRestarts ?? 3;
		if (this._restartCount >= maxRestarts) {
			return;
		}
		this._restartCount++;
		this._exitInfo = null;
		this.start();
	}

	private _parseLines(chunk: string): void {
		for (const line of chunk.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			try {
				const message = JSON.parse(trimmed);
				this._onDidMessage.fire(message);
			} catch {
				this._onDidError.fire(new Error(`[extension-host] non-JSON output: ${trimmed.slice(0, 200)}`));
			}
		}
	}

	override dispose(): void {
		this.stop();
		super.dispose();
	}
}
