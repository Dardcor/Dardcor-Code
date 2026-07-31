/**
 * Dardcor Code - Reverse Port Tunnel For Exposing Local Server To Remote Host (Task 826)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface IReverseTunnelOptions {
	readonly host: string;
	readonly username?: string;
	readonly sshPort?: number;
	readonly identityFile?: string;
	readonly remotePort: number;
	readonly localPort: number;
	readonly localHost?: string;
	readonly bindAddress?: string;
	readonly extraArgs?: string[];
}

export const enum ReverseTunnelState {
	Connecting = 0,
	Established = 1,
	Failed = 2,
	Closed = 3
}

export interface IReverseTunnelHandle {
	readonly id: string;
	state: ReverseTunnelState;
	close(): void;
}

export class ReverseTunnel extends Disposable {
	private readonly _tunnels = new Map<string, { handle: IReverseTunnelHandle; child: ChildProcess }>();
	private _nextId = 1;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(private readonly _sshBinary = 'ssh') {
		super();
	}

	open(options: IReverseTunnelOptions): IReverseTunnelHandle {
		const id = String(this._nextId++);
		const handle: IReverseTunnelHandle = {
			id,
			state: ReverseTunnelState.Connecting,
			close: () => this.close(id)
		};

		const spec = options.bindAddress
			? `${options.bindAddress}:${options.remotePort}:${options.localHost ?? 'localhost'}:${options.localPort}`
			: `${options.remotePort}:${options.localHost ?? 'localhost'}:${options.localPort}`;
		const args = ['-N', '-R', spec];
		if (options.sshPort) {
			args.push('-p', String(options.sshPort));
		}
		if (options.identityFile) {
			args.push('-i', options.identityFile);
		}
		args.push('-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10');
		args.push(...(options.extraArgs ?? []));
		const target = options.username ? `${options.username}@${options.host}` : options.host;
		args.push(target);

		const child = spawn(this._sshBinary, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true
		});
		this._tunnels.set(id, { handle, child });

		let settled = false;
		child.on('error', (error: NodeJS.ErrnoException) => {
			if (settled) {
				return;
			}
			settled = true;
			handle.state = ReverseTunnelState.Failed;
			if (error.code === 'ENOENT') {
				this._onError.fire(new Error(`SSH client '${this._sshBinary}' not found (ENOENT). Install OpenSSH and ensure it is on PATH.`));
			} else {
				this._onError.fire(error);
			}
			this._onDidChange.fire();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			if (!settled && /forwarding (to|of)/i.test(chunk.toString('utf8'))) {
				settled = true;
				handle.state = ReverseTunnelState.Established;
				this._onDidChange.fire();
			}
		});
		child.on('exit', () => {
			settled = true;
			handle.state = ReverseTunnelState.Closed;
			this._tunnels.delete(id);
			this._onDidChange.fire();
		});
		setTimeout(() => {
			if (!settled) {
				settled = true;
				handle.state = ReverseTunnelState.Established;
				this._onDidChange.fire();
			}
		}, 1500);

		return handle;
	}

	close(id: string): void {
		const entry = this._tunnels.get(id);
		if (!entry) {
			return;
		}
		this._tunnels.delete(id);
		try {
			entry.child.kill('SIGTERM');
		} catch {
			// ignore
		}
		entry.handle.state = ReverseTunnelState.Closed;
		this._onDidChange.fire();
	}

	list(): IReverseTunnelHandle[] {
		return [...this._tunnels.values()].map(e => e.handle);
	}

	closeAll(): void {
		for (const id of [...this._tunnels.keys()]) {
			this.close(id);
		}
	}

	override dispose(): void {
		this.closeAll();
		super.dispose();
	}
}
