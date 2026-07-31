import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerRemoteTunnel {
	readonly id: string;
	readonly remoteHost: string;
	readonly remotePort: number;
	readonly localPort: number;
	readonly protocol: string;
}

export interface IServerRemoteTunnelService {
	readonly onDidCreateTunnel: Event<IServerRemoteTunnel>;
	readonly onDidCloseTunnel: Event<string>;
	createTunnel(remoteHost: string, remotePort: number, localPort?: number, protocol?: string): Promise<IServerRemoteTunnel>;
	closeTunnel(id: string): Promise<void>;
	getTunnel(id: string): IServerRemoteTunnel | undefined;
	getTunnels(): IServerRemoteTunnel[];
}

export class ServerRemoteTunnelCommon implements IServerRemoteTunnelService {
	private readonly _tunnels = new Map<string, IServerRemoteTunnel>();
	private _nextId = 1;

	private readonly _onDidCreateTunnel = new Emitter<IServerRemoteTunnel>();
	readonly onDidCreateTunnel = this._onDidCreateTunnel.event;

	private readonly _onDidCloseTunnel = new Emitter<string>();
	readonly onDidCloseTunnel = this._onDidCloseTunnel.event;

	async createTunnel(remoteHost: string, remotePort: number, localPort?: number, protocol?: string): Promise<IServerRemoteTunnel> {
		const id = `tunnel-${this._nextId++}`;
		const tunnel: IServerRemoteTunnel = {
			id,
			remoteHost,
			remotePort,
			localPort: localPort || remotePort,
			protocol: protocol || 'http'
		};
		this._tunnels.set(id, tunnel);
		this._onDidCreateTunnel.fire(tunnel);
		return tunnel;
	}

	async closeTunnel(id: string): Promise<void> {
		if (this._tunnels.has(id)) {
			this._tunnels.delete(id);
			this._onDidCloseTunnel.fire(id);
		}
	}

	getTunnel(id: string): IServerRemoteTunnel | undefined {
		return this._tunnels.get(id);
	}

	getTunnels(): IServerRemoteTunnel[] {
		return Array.from(this._tunnels.values());
	}
}
