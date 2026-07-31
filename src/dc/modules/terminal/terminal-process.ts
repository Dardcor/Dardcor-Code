/**
 * Dardcor Code - Native Terminal Spawn Process Bridge
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { isWindows } from '../../core/environment/platform';
import { IConfigurationService, ConfigurationService } from '../../services/configuration/configuration-service';

declare const require: any;

export interface ITerminalProcessOptions {
	shell?: string;
	cwd?: string;
	env?: Record<string, string>;
	cols?: number;
	rows?: number;
}

export interface ITerminalExitEvent {
	readonly exitCode: number | null;
	readonly signal: string | null;
}

export class TerminalProcess extends Disposable {
	private readonly _onData = this._register(new Emitter<string>());
	readonly onData: Event<string> = this._onData.event;

	private readonly _onExit = this._register(new Emitter<ITerminalExitEvent>());
	readonly onExit: Event<ITerminalExitEvent> = this._onExit.event;

	private readonly _onError = this._register(new Emitter<string>());
	readonly onError: Event<string> = this._onError.event;

	private readonly _onDidResize = this._register(new Emitter<void>());
	readonly onDidResize: Event<void> = this._onDidResize.event;

	private _child: any = undefined;
	private _cols: number;
	private _rows: number;
	private _started = false;
	private _exited = false;

	constructor(
		cols = 80,
		rows = 24,
		private readonly _configurationService?: IConfigurationService
	) {
		super();
		this._cols = cols;
		this._rows = rows;
	}

	get cols(): number {
		return this._cols;
	}

	get rows(): number {
		return this._rows;
	}

	get isStarted(): boolean {
		return this._started;
	}

	get exitCode(): number | null {
		return this._exited && this._child ? this._child.exitCode : null;
	}

	public start(options: ITerminalProcessOptions = {}): void {
		if (this._started) {
			return;
		}
		this._started = true;

		const cp = require('node:child_process');
		const shell = this._resolveShell(options.shell);
		const env = { ...process.env, ...options.env };
		env['COLUMNS'] = String(this._cols);
		env['LINES'] = String(this._rows);
		if (!env['TERM']) {
			env['TERM'] = 'xterm-256color';
		}

		let child: any;
		try {
			child = cp.spawn(shell, [], {
				shell: true,
				cwd: options.cwd,
				env,
				windowsHide: true
			});
		} catch (err) {
			this._onError.fire(`Gagal memulai shell: ${String(err)}`);
			this._exited = true;
			return;
		}
		this._child = child;

		child.stdout?.setEncoding('utf8');
		child.stdout?.on('data', (chunk: string) => {
			if (!this._exited) {
				this._onData.fire(chunk);
			}
		});
		child.stderr?.setEncoding('utf8');
		child.stderr?.on('data', (chunk: string) => {
			if (!this._exited) {
				this._onData.fire(chunk);
			}
		});
		child.on('error', (err: any) => {
			if (err?.code === 'ENOENT') {
				this._onError.fire(`Shell '${shell}' tidak ditemukan. Periksa pengaturan terminal.integrated.shell.`);
			} else {
				this._onError.fire(String(err));
			}
		});
		child.on('close', (code: number | null, signal: string | null) => {
			this._exited = true;
			this._onExit.fire({ exitCode: code, signal });
		});
	}

	private _resolveShell(custom?: string): string {
		if (custom) {
			return custom;
		}
		if (this._configurationService) {
			const configured = this._configurationService.getValue<string>('terminal.integrated.shell');
			if (configured) {
				return configured;
			}
		}
		if (isWindows) {
			const comspec = process.env?.COMSPEC;
			return comspec ? comspec.replace(/\\/g, '/') : 'cmd.exe';
		}
		return process.env?.SHELL || '/bin/bash';
	}

	public write(data: string): void {
		if (!this._child || !this._child.stdin || this._exited) {
			return;
		}
		try {
			this._child.stdin.write(data);
		} catch (err) {
			this._onError.fire(String(err));
		}
	}

	public resize(cols: number, rows: number): void {
		if (cols < 2 || rows < 1 || (cols === this._cols && rows === this._rows)) {
			return;
		}
		this._cols = cols;
		this._rows = rows;
		if (this._child && !this._exited && this._child.pid) {
			try {
				this._child.stdout.setEncoding('utf8');
			} catch {
				// ignore
			}
		}
		this._onDidResize.fire();
	}

	public kill(signal = 'SIGTERM'): void {
		if (this._child && !this._exited) {
			try {
				this._child.kill(signal);
			} catch {
				// ignore
			}
		}
	}

	public get pid(): number | undefined {
		return this._child?.pid;
	}
}

export function createDefaultTerminalProcess(configurationService?: IConfigurationService): TerminalProcess {
	return new TerminalProcess(80, 24, configurationService ?? new ConfigurationService());
}
