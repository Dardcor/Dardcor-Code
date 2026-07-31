/**
 * Dardcor Code - Tunnel Service (Task 152)
 * Mirrors: vs/platform/tunnel/common/tunnel.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface RemoteTunnel {
	readonly tunnelRemotePort: number;
	readonly tunnelRemoteHost: string;
	readonly localAddress: string;
	dispose(): Promise<void>;
}

export const ITunnelService = Symbol('ITunnelService');

export interface ITunnelService {
	readonly onTunnelOpened: Event<RemoteTunnel>;
	readonly onTunnelClosed: Event<{ host: string; port: number }>;
	readonly tunnels: Promise<readonly RemoteTunnel[]>;
	openTunnel(remoteHost: string, remotePort: number, localPort?: number): Promise<RemoteTunnel | undefined>;
}

export class TunnelService implements ITunnelService {
	private readonly _tunnels = new Map<number, RemoteTunnel>();
	private readonly _onTunnelOpened = new Emitter<RemoteTunnel>();
	private readonly _onTunnelClosed = new Emitter<{ host: string; port: number }>();

	readonly onTunnelOpened = this._onTunnelOpened.event;
	readonly onTunnelClosed = this._onTunnelClosed.event;

	get tunnels(): Promise<readonly RemoteTunnel[]> {
		return Promise.resolve(Array.from(this._tunnels.values()));
	}

	async openTunnel(remoteHost: string, remotePort: number, localPort?: number): Promise<RemoteTunnel | undefined> {
		const lp = localPort || remotePort;
		const tunnel: RemoteTunnel = {
			tunnelRemotePort: remotePort,
			tunnelRemoteHost: remoteHost,
			localAddress: `127.0.0.1:${lp}`,
			dispose: async () => {
				this._tunnels.delete(remotePort);
				this._onTunnelClosed.fire({ host: remoteHost, port: remotePort });
			}
		};
		this._tunnels.set(remotePort, tunnel);
		this._onTunnelOpened.fire(tunnel);
		return tunnel;
	}
}
