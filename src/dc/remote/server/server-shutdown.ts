import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import type { Server } from 'node:http';
import type { Socket } from 'node:net';

export interface IShutdownInfo {
	readonly reason: string;
	readonly startedAt: number;
	readonly taskCount: number;
}

export interface IShutdownResult {
	readonly tasksCompleted: number;
	readonly tasksFailed: number;
	readonly connectionsClosed: number;
	readonly exitCode: number;
}

export interface IServerShutdownOptions {
	readonly exitOnComplete?: boolean;
	readonly forceExitAfterMs?: number;
	readonly closeConnectionsTimeoutMs?: number;
}

export class ServerShutdown extends Disposable {
	private readonly _tasks: Array<{ name: string; fn: () => Promise<void> | void }> = [];
	private readonly _connections = new Set<Socket>();
	private readonly _exitOnComplete: boolean;
	private readonly _forceExitAfterMs: number;
	private readonly _closeConnectionsTimeoutMs: number;

	private _shuttingDown = false;
	private _forceTimer: ReturnType<typeof setTimeout> | null = null;
	private _forceExitFn: (() => void) | null = null;

	private readonly _onWillShutdown = this._register(new Emitter<IShutdownInfo>());
	readonly onWillShutdown: Event<IShutdownInfo> = this._onWillShutdown.event;

	private readonly _onDidShutdown = this._register(new Emitter<IShutdownResult>());
	readonly onDidShutdown: Event<IShutdownResult> = this._onDidShutdown.event;

	constructor(
		private readonly _server: Server | null = null,
		options: IServerShutdownOptions = {}
	) {
		super();
		this._exitOnComplete = options.exitOnComplete ?? true;
		this._forceExitAfterMs = options.forceExitAfterMs ?? 15000;
		this._closeConnectionsTimeoutMs = options.closeConnectionsTimeoutMs ?? 2000;
	}

	get isShuttingDown(): boolean {
		return this._shuttingDown;
	}

	get taskCount(): number {
		return this._tasks.length;
	}

	get connectionCount(): number {
		return this._connections.size;
	}

	addShutdownTask(fn: () => Promise<void> | void, name = `task-${this._tasks.length + 1}`): void {
		this._tasks.push({ name, fn });
	}

	trackConnection(socket: Socket): void {
		this._connections.add(socket);
		socket.once('close', () => this._connections.delete(socket));
	}

	setForceExitHandler(fn: () => void): void {
		this._forceExitFn = fn;
	}

	forceExitAfter(ms: number): void {
		if (this._forceTimer) {
			clearTimeout(this._forceTimer);
		}
		this._forceTimer = setTimeout(() => {
			if (!this._shuttingDown) {
				return;
			}
			if (this._forceExitFn) {
				this._forceExitFn();
			} else if (typeof process !== 'undefined') {
				process.exit(1);
			}
		}, ms);
		if (typeof this._forceTimer !== 'undefined' && typeof (this._forceTimer as unknown as { unref?: () => void }).unref === 'function') {
			(this._forceTimer as unknown as { unref: () => void }).unref();
		}
	}

	async shutdown(reason: string, exitCode = 0): Promise<IShutdownResult> {
		if (this._shuttingDown) {
			return this._lastResult;
		}
		this._shuttingDown = true;
		const startedAt = Date.now();
		this._onWillShutdown.fire({ reason, startedAt, taskCount: this._tasks.length });
		this.forceExitAfter(this._forceExitAfterMs);

		let tasksCompleted = 0;
		let tasksFailed = 0;
		for (const task of this._tasks) {
			try {
				await task.fn();
				tasksCompleted++;
			} catch {
				tasksFailed++;
			}
		}
		this._tasks.length = 0;

		const connectionsClosed = await this._closeServerAndConnections();

		const result: IShutdownResult = {
			tasksCompleted,
			tasksFailed,
			connectionsClosed,
			exitCode
		};
		this._lastResult = result;
		this._onDidShutdown.fire(result);
		if (this._forceTimer) {
			clearTimeout(this._forceTimer);
			this._forceTimer = null;
		}
		if (this._exitOnComplete && typeof process !== 'undefined') {
			setTimeout(() => process.exit(exitCode), 0);
		}
		return result;
	}

	async closeConnections(): Promise<number> {
		return this._closeServerAndConnections();
	}

	abort(reason: string): void {
		this._shuttingDown = false;
		if (this._forceTimer) {
			clearTimeout(this._forceTimer);
			this._forceTimer = null;
		}
		void reason;
	}

	private _lastResult: IShutdownResult = { tasksCompleted: 0, tasksFailed: 0, connectionsClosed: 0, exitCode: 0 };

	private async _closeServerAndConnections(): Promise<number> {
		let closed = 0;
		const sockets = [...this._connections];
		for (const socket of sockets) {
			try {
				socket.end();
				closed++;
			} catch {
				try {
					socket.destroy();
					closed++;
				} catch {
					// ignore
				}
			}
		}
		this._connections.clear();
		if (this._server?.listening) {
			await new Promise<void>(resolvePromise => {
				const timer = setTimeout(resolvePromise, this._closeConnectionsTimeoutMs);
				this._server!.close(() => {
					clearTimeout(timer);
					resolvePromise();
				});
			});
		}
		return closed;
	}

	override dispose(): void {
		this._shuttingDown = false;
		if (this._forceTimer) {
			clearTimeout(this._forceTimer);
			this._forceTimer = null;
		}
		super.dispose();
	}
}
