/**
 * Dardcor Code - SSH Tunnel Client & Port Forwarding Manager (Task 806)
 */

import { spawn, ChildProcess } from 'node:child_process';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { getFreePort } from './port-forwarding-manager.js';

export interface ISshTunnelOptions {
	readonly host: string;
	readonly username?: string;
	readonly sshPort?: number;
	readonly identityFile?: string;
	readonly localPort?: number;
	readonly remotePort: number;
	readonly forwardHost?: string;
	readonly label?: string;
	readonly extraArgs?: string[];
}

export const enum SshTunnelState {
	Connecting = 0,
	Established = 1,
	Failed = 2,
	Closed = 3
}

export interface ISshTunnel {
	readonly id: string;
	readonly options: ISshTunnelOptions;
	readonly localPort: number;
	readonly remotePort: number;
	state: SshTunnelState;
}

export class SshTunnelService extends Disposable {
	private readonly _tunnels = new Map<string, { tunnel: ISshTunnel; child: ChildProcess }>();
	private _nextId = 1;

	private readonly _onDidChangeTunnels = this._register(new Emitter<void>());
	readonly onDidChangeTunnels: Event<void> = this._onDidChangeTunnels.event;

	private readonly _onTunnelOutput = this._register(new Emitter<{ id: string; output: string }>());
	readonly onTunnelOutput: Event<{ id: string; output: string }> = this._onTunnelOutput.event;

	constructor(private readonly _sshBinary = 'ssh') {
		super();
	}

	async openTunnel(options: ISshTunnelOptions): Promise<ISshTunnel> {
		const localPort = options.localPort ?? await getFreePort();
		const id = String(this._nextId++);
		const tunnel: ISshTunnel = {
			id,
			options,
			localPort,
			remotePort: options.remotePort,
			state: SshTunnelState.Connecting
		};

		const args = [
			'-N',
			'-L', `${localPort}:${options.forwardHost ?? 'localhost'}:${options.remotePort}`
		];
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

		let settled = false;
		await new Promise<void>((resolvePromise, reject) => {
			child.on('error', (error: NodeJS.ErrnoException) => {
				if (settled) {
					return;
				}
				settled = true;
				tunnel.state = SshTunnelState.Failed;
				this._tunnels.delete(id);
				if (error.code === 'ENOENT') {
					reject(new Error(`SSH client '${this._sshBinary}' not found (ENOENT). Install OpenSSH and ensure it is on PATH.`));
				} else {
					reject(error);
				}
			});
			child.stderr.on('data', (chunk: Buffer) => {
				const output = chunk.toString('utf8');
				if (!settled && /forwarding (to|of)/i.test(output)) {
					settled = true;
					tunnel.state = SshTunnelState.Established;
					resolvePromise();
				}
				this._onTunnelOutput.fire({ id, output });
			});
			child.on('exit', () => {
				if (!settled) {
					settled = true;
					tunnel.state = SshTunnelState.Failed;
					resolvePromise();
				}
				tunnel.state = SshTunnelState.Closed;
				this._tunnels.delete(id);
				this._onDidChangeTunnels.fire();
			});
			// Assume the tunnel established after a short grace period if no failure was reported.
			setTimeout(() => {
				if (!settled) {
					settled = true;
					tunnel.state = SshTunnelState.Established;
					resolvePromise();
				}
			}, 1500);
		});

		this._tunnels.set(id, { tunnel, child });
		this._onDidChangeTunnels.fire();
		return tunnel;
	}

	closeTunnel(id: string): void {
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
		entry.tunnel.state = SshTunnelState.Closed;
		this._onDidChangeTunnels.fire();
	}

	list(): ISshTunnel[] {
		return [...this._tunnels.values()].map(e => e.tunnel);
	}

	get count(): number {
		return this._tunnels.size;
	}

	closeAll(): void {
		for (const id of [...this._tunnels.keys()]) {
			this.closeTunnel(id);
		}
	}

	override dispose(): void {
		this.closeAll();
		super.dispose();
	}
}
