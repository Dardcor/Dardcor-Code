/**
 * Dardcor Code - Pseudo-Terminal Process Executor (Task 198)
 * Mirrors: vs/platform/terminal/node/ptyHostService.ts (shell PTY via child_process, no node-pty)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IPtyOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly cols?: number;
	readonly rows?: number;
}

export interface IPtyProcess extends IDisposable {
	readonly pid: number;
	readonly onData: Event<string>;
	readonly onExit: Event<number>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
}

const IS_PROCESS_AVAILABLE = typeof process !== 'undefined' && typeof process.env === 'object';

export class PtyProcess implements IPtyProcess {
	private readonly _child: ChildProcess | null = null;
	private readonly _onData = new Emitter<string>();
	private readonly _onExit = new Emitter<number>();

	readonly pid: number;
	readonly onData: Event<string> = this._onData.event;
	readonly onExit: Event<number> = this._onExit.event;

	private _cols: number;
	private _rows: number;
	private _exited = false;

	constructor(command: string, args: string[] = [], options: IPtyOptions = {}) {
		this._cols = options.cols ?? 80;
		this._rows = options.rows ?? 30;

		if (!IS_PROCESS_AVAILABLE) {
			this.pid = 0;
			setTimeout(() => {
				this._onData.fire(`[PtyProcess] shell '${command}' unavailable in this environment\r\n`);
				this._onExit.fire(0);
			}, 0);
			return;
		}

		try {
			const shellCommand = `${command}${args.length > 0 ? ` ${args.map(a => quoteArg(a)).join(' ')}` : ''}`;
			this._child = spawn(shellCommand, {
				shell: true,
				cwd: options.cwd,
				env: options.env ?? (process.env as Record<string, string>),
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			this.pid = this._child.pid ?? 0;

			this._child.stdout?.on('data', (chunk: Buffer) => {
				this._onData.fire(chunk.toString('utf8'));
			});
			this._child.stderr?.on('data', (chunk: Buffer) => {
				this._onData.fire(chunk.toString('utf8'));
			});
			this._child.on('error', (err: Error) => {
				this._onData.fire(`\r\n[PtyProcess] failed to spawn: ${err.message}\r\n`);
			});
			this._child.on('exit', (code: number | null) => {
				if (!this._exited) {
					this._exited = true;
					this._onExit.fire(code ?? -1);
				}
			});
			this._child.on('close', () => {
				if (!this._exited) {
					this._exited = true;
					this._onExit.fire(-1);
				}
			});
		} catch (err) {
			this.pid = 0;
			setTimeout(() => {
				this._onData.fire(`\r\n[PtyProcess] spawn error: ${String(err)}\r\n`);
				this._onExit.fire(-1);
			}, 0);
		}
	}

	write(data: string): void {
		this._child?.stdin?.write(data);
	}

	resize(cols: number, rows: number): void {
		this._cols = Math.max(2, Math.floor(cols));
		this._rows = Math.max(1, Math.floor(rows));
	}

	dispose(): void {
		if (!this._exited) {
			this._exited = true;
			this._child?.kill();
			this._onExit.fire(-1);
		}
		this._onData.dispose();
		this._onExit.dispose();
	}
}

function quoteArg(arg: string): string {
	if (/^[\w@%+=:,./-]+$/.test(arg)) {
		return arg;
	}
	return `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}
