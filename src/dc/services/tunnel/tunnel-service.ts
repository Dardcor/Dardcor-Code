/**
 * Dardcor Code - Tunnel Service (Task 152)
 * Mirrors: vs/platform/tunnel/common/tunnel.ts (local port forwarding engine)
 */

import { createDecorator } from '../instantiation/annotations';
import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

declare const require: any;

export interface RemoteTunnel {
	readonly tunnelRemotePort: number;
	readonly tunnelRemoteHost: string;
	readonly localAddress: string;
	dispose(): Promise<void>;
}

export const ITunnelService = createDecorator<ITunnelService>('tunnelService');

export interface ITunnelService {
	readonly _serviceBrand: undefined;
	readonly onTunnelOpened: Event<RemoteTunnel>;
	readonly onTunnelClosed: Event<{ host: string; port: number }>;
	readonly tunnels: Promise<readonly RemoteTunnel[]>;
	openTunnel(remoteHost: string, remotePort: number, localPort?: number): Promise<RemoteTunnel | undefined>;
}

interface IForwardingServer {
	listening: boolean;
	address(): { port: number } | null;
	close(callback?: () => void): void;
}

export class TunnelService extends Disposable implements ITunnelService {
	declare readonly _serviceBrand: undefined;

	private readonly _tunnels = new Map<number, RemoteTunnel>();
	private readonly _servers = new Map<number, IForwardingServer>();

	private readonly _onTunnelOpened = this._register(new Emitter<RemoteTunnel>());
	private readonly _onTunnelClosed = this._register(new Emitter<{ host: string; port: number }>());

	readonly onTunnelOpened = this._onTunnelOpened.event;
	readonly onTunnelClosed = this._onTunnelClosed.event;

	constructor() {
		super();
	}

	get tunnels(): Promise<readonly RemoteTunnel[]> {
		return Promise.resolve(Array.from(this._tunnels.values()));
	}

	async openTunnel(remoteHost: string, remotePort: number, localPort?: number): Promise<RemoteTunnel | undefined> {
		const existing = this._tunnels.get(remotePort);
		if (existing) {
			return existing;
		}
		const server = await this._createForwardingServer(remoteHost, remotePort, localPort ?? remotePort);
		if (!server) {
			return undefined;
		}
		const actualPort = server.address()?.port ?? localPort ?? remotePort;
		const tunnel: RemoteTunnel = {
			tunnelRemotePort: remotePort,
			tunnelRemoteHost: remoteHost,
			localAddress: `127.0.0.1:${actualPort}`,
			dispose: async () => {
				this._servers.delete(remotePort);
				this._tunnels.delete(remotePort);
				await new Promise<void>((resolve) => {
					if (server.listening) {
						server.close(() => resolve());
					} else {
						resolve();
					}
				});
				this._onTunnelClosed.fire({ host: remoteHost, port: remotePort });
			},
		};
		this._tunnels.set(remotePort, tunnel);
		this._servers.set(remotePort, server);
		this._onTunnelOpened.fire(tunnel);
		return tunnel;
	}

	private _createForwardingServer(remoteHost: string, remotePort: number, localPort: number): Promise<IForwardingServer | undefined> {
		return new Promise((resolve) => {
			try {
				const nodeRequire = typeof require === 'function' ? require : undefined;
				const net = nodeRequire?.('net');
				if (!net) {
					resolve(undefined);
					return;
				}
				const server = net.createServer((socket: any) => {
					const remote = net.connect(remotePort, remoteHost);
					socket.pipe(remote).pipe(socket);
					socket.on('error', () => remote.destroy());
					remote.on('error', () => socket.destroy());
				});
				server.on('error', () => resolve(undefined));
				server.listen(localPort, '127.0.0.1', () => resolve(server));
			} catch {
				resolve(undefined);
			}
		});
	}
}
