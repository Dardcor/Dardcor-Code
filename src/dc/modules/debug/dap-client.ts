/**
 * Dardcor Code - Debug Adapter Protocol (DAP) JSON-RPC Client
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

declare const require: any;

export interface IDapRequest<T = any> {
	seq: number;
	type: 'request';
	command: string;
	arguments?: T;
}

export interface IDapResponse<T = any> {
	seq: number;
	type: 'response';
	request_seq: number;
	success: boolean;
	command: string;
	message?: string;
	body?: T;
}

export interface IDapEvent<T = any> {
	seq: number;
	type: 'event';
	event: string;
	body?: T;
}

export interface IDapLaunchOptions {
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string>;
}

export class DapClient extends Disposable {
	private readonly _onDidEvent = this._register(new Emitter<IDapEvent>());
	readonly onDidEvent: Event<IDapEvent> = this._onDidEvent.event;

	private readonly _onDidExit = this._register(new Emitter<{ code: number | null; signal: string | null }>());
	readonly onDidExit: Event<{ code: number | null; signal: string | null }> = this._onDidExit.event;

	private readonly _onDidError = this._register(new Emitter<string>());
	readonly onDidError: Event<string> = this._onDidError.event;

	private _seq = 1;
	private _child: any = undefined;
	private _pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
	private _buffer = '';
	private _stopped = false;

	public get isRunning(): boolean {
		return !!this._child && !this._child.killed;
	}

	public async start(options: IDapLaunchOptions): Promise<void> {
		const cp = require('node:child_process');
		await new Promise<void>((resolve, reject) => {
			let child: any;
			try {
				child = cp.spawn(options.command, options.args, {
					cwd: options.cwd,
					env: options.env ? { ...process.env, ...options.env } : process.env,
					windowsHide: true
				});
			} catch (err) {
				this._onDidError.fire(String(err));
				reject(err);
				return;
			}
			this._child = child;

			child.stdout?.setEncoding('utf8');
			child.stdout?.on('data', (chunk: string) => {
				this._processChunk(chunk);
			});
			child.stderr?.setEncoding('utf8');
			child.stderr?.on('data', (chunk: string) => {
				this._onDidError.fire(chunk);
			});
			child.on('error', (err: any) => {
				this._onDidError.fire(`Debug adapter gagal dijalankan: ${String(err)}`);
				this._rejectAll(new Error(String(err)));
				reject(err);
			});
			child.on('close', (code: number, signal: string) => {
				this._child = undefined;
				this._rejectAll(new Error('Debug adapter berhenti'));
				this._onDidExit.fire({ code, signal });
			});
			resolve();
		});
	}

	public request<T = any>(command: string, args?: any): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const seq = this._seq++;
			this._pending.set(seq, { resolve, reject });
			this._sendMessage({ seq, type: 'request', command, arguments: args ?? {} } satisfies IDapRequest);
		});
	}

	public stop(): void {
		if (this._child) {
			try {
				this._sendMessage({ seq: this._seq++, type: 'request', command: 'disconnect', arguments: { terminateDebuggee: true } } satisfies IDapRequest);
			} catch {
				// ignore
			}
			try {
				this._child.kill();
			} catch {
				// ignore
			}
			this._child = undefined;
		}
		this._rejectAll(new Error('Client dihentikan'));
	}

	private _sendMessage(message: IDapRequest): void {
		if (!this._child || !this._child.stdin) {
			throw new Error('Debug adapter tidak berjalan');
		}
		const body = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
		this._child.stdin.write(header + body);
	}

	private _processChunk(chunk: string): void {
		this._buffer += chunk;
		while (true) {
			const headerEnd = this._buffer.indexOf('\r\n\r\n');
			if (headerEnd === -1) {
				if (this._buffer.length > 4096) {
					this._buffer = '';
				}
				return;
			}
			const headerText = this._buffer.substring(0, headerEnd);
			const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
			if (!lengthMatch) {
				this._buffer = this._buffer.substring(headerEnd + 4);
				continue;
			}
			const contentLength = parseInt(lengthMatch[1], 10);
			if (this._buffer.length < headerEnd + 4 + contentLength) {
				return;
			}
			const body = this._buffer.substring(headerEnd + 4, headerEnd + 4 + contentLength);
			this._buffer = this._buffer.substring(headerEnd + 4 + contentLength);
			this._handleMessage(body);
		}
	}

	private _handleMessage(body: string): void {
		let message: any;
		try {
			message = JSON.parse(body);
		} catch {
			this._onDidError.fire('Pesan DAP tidak valid');
			return;
		}
		if (message.type === 'response') {
			const pending = this._pending.get(message.request_seq);
			if (pending) {
				this._pending.delete(message.request_seq);
				if (message.success) {
					pending.resolve(message.body);
				} else {
					pending.reject(new Error(message.message ?? `DAP error: ${message.command}`));
				}
			}
		} else if (message.type === 'event') {
			this._onDidEvent.fire(message as IDapEvent);
		}
	}

	private _rejectAll(err: Error): void {
		for (const [seq, pending] of this._pending) {
			this._pending.delete(seq);
			pending.reject(err);
		}
	}
}
