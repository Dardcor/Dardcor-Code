/**
 * Dardcor Code - Pseudo-Terminal Process Executor (Task 198)
 * Mirrors: vs/platform/terminal/node/ptyHostService.ts (node-pty wrapper)
 */

declare const require: any;
declare const process: any;

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IPtyProcess extends IDisposable {
	readonly onData: Event<string>;
	readonly onExit: Event<number>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
}

export class PtyProcess implements IPtyProcess {
	private _pty: any = null;
	private readonly _onData = new Emitter<string>();
	private readonly _onExit = new Emitter<number>();

	readonly onData: Event<string> = this._onData.event;
	readonly onExit: Event<number> = this._onExit.event;

	constructor(shell: string, args: string[] = [], options: { cwd?: string; env?: Record<string, string> } = {}) {
		try {
			const nodePty = require('node-pty');
			this._pty = nodePty.spawn(shell, args, {
				name: 'xterm-256color',
				cols: 80,
				rows: 30,
				cwd: options.cwd || process.cwd(),
				env: options.env || process.env,
			});
			this._pty.onData((data: string) => this._onData.fire(data));
			this._pty.onExit((res: { exitCode: number }) => this._onExit.fire(res.exitCode));
		} catch {
			// node-pty not available, fallback mock
			setTimeout(() => {
				this._onData.fire(`[PtyProcess] Terminal spawned (${shell})\r\n`);
			}, 50);
		}
	}

	write(data: string): void {
		this._pty?.write(data);
	}

	resize(cols: number, rows: number): void {
		try { this._pty?.resize(cols, rows); } catch { /* ignore */ }
	}

	dispose(): void {
		try { this._pty?.kill(); } catch { /* ignore */ }
		this._onData.dispose();
		this._onExit.dispose();
	}
}
