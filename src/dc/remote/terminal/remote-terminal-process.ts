/**
 * Dardcor Code - Child Process Execution Proxy For Remote Shell Terminal (Task 831)
 */

import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { Shell } from '../../core/system/shell';

export interface IRemoteTerminalProcessOptions {
	readonly shell?: string;
	readonly args?: string[];
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly cols?: number;
	readonly rows?: number;
}

export interface IRemoteTerminalExitInfo {
	readonly code: number | null;
	readonly signal: string | null;
}

export class RemoteTerminalProcess extends Disposable {
	private _child: ChildProcessWithoutNullStreams | null = null;
	private _exitInfo: IRemoteTerminalExitInfo | null = null;
	private _cols: number;
	private _rows: number;

	private readonly _onData = this._register(new Emitter<Uint8Array>());
	readonly onData: Event<Uint8Array> = this._onData.event;

	private readonly _onExit = this._register(new Emitter<IRemoteTerminalExitInfo>());
	readonly onExit: Event<IRemoteTerminalExitInfo> = this._onExit.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(private readonly _options: IRemoteTerminalProcessOptions) {
		super();
		this._cols = _options.cols ?? 80;
		this._rows = _options.rows ?? 24;
		this._start();
	}

	get pid(): number | undefined {
		return this._child?.pid;
	}

	get exited(): IRemoteTerminalExitInfo | null {
		return this._exitInfo;
	}

	get dimensions(): { cols: number; rows: number } {
		return { cols: this._cols, rows: this._rows };
	}

	write(data: Uint8Array | string): void {
		if (!this._child || this._exitInfo) {
			return;
		}
		try {
			this._child.stdin.write(data);
		} catch (error) {
			this._onError.fire(error instanceof Error ? error : new Error(String(error)));
		}
	}

	resize(cols: number, rows: number): void {
		this._cols = Math.max(1, cols);
		this._rows = Math.max(1, rows);
	}

	kill(signal: NodeJS.Signals | number = 'SIGTERM'): void {
		if (this._child && !this._exitInfo) {
			try {
				this._child.kill(signal);
			} catch (error) {
				this._onError.fire(error instanceof Error ? error : new Error(String(error)));
			}
		}
	}

	terminate(): void {
		if (this._child && !this._exitInfo) {
			this._child.kill('SIGKILL');
		}
	}

	private _start(): void {
		const shell = this._options.shell ?? Shell.getDefaultShell();
		const args = this._options.args ?? (isPowershell(shell) ? ['-NoLogo'] : ['-i']);
		const env: Record<string, string> = {
			...(typeof process !== 'undefined' && process.env ? process.env as Record<string, string> : {}),
			...this._options.env,
			TERM: this._options.env?.TERM ?? 'xterm-256color',
			COLUMNS: String(this._cols),
			LINES: String(this._rows),
			COLORTERM: this._options.env?.COLORTERM ?? 'truecolor'
		};

		let child: ChildProcessWithoutNullStreams;
		try {
			child = spawn(shell, args, {
				cwd: this._options.cwd,
				env,
				stdio: ['pipe', 'pipe', 'pipe'],
				shell: false
			});
		} catch (error) {
			this._onError.fire(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		this._child = child;

		child.on('error', (error: NodeJS.ErrnoException) => {
			if (error.code === 'ENOENT') {
				this._onError.fire(new Error(`Shell '${shell}' not found (ENOENT). Install it or configure a different shell.`));
			} else {
				this._onError.fire(error);
			}
		});

		child.stdout.on('data', (chunk: Buffer) => {
			this._onData.fire(new Uint8Array(chunk));
		});
		child.stderr.on('data', (chunk: Buffer) => {
			this._onData.fire(new Uint8Array(chunk));
		});

		child.on('exit', (code, signal) => {
			this._exitInfo = { code, signal };
			this._onExit.fire(this._exitInfo);
			this._child = null;
		});
	}

	override dispose(): void {
		if (this._child && !this._exitInfo) {
			try {
				this._child.kill('SIGKILL');
			} catch {
				// ignore
			}
		}
		this._child = null;
		super.dispose();
	}
}

function isPowershell(shell: string): boolean {
	const lower = shell.toLowerCase();
	return lower.includes('powershell') || lower.endsWith('pwsh') || lower.endsWith('pwsh.exe');
}
