import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostTunnel {
	private readonly _tunnels = new Map<string, any>();

	async openTunnel(options: any): Promise<any> {
		const id = `tunnel-${Math.random().toString(36).substr(2, 9)}`;
		const tunnel = {
			remoteAddress: options.remoteAddress,
			localAddress: `127.0.0.1:${options.remoteAddress.port}`,
			dispose: () => {
				this._tunnels.delete(id);
			}
		};
		this._tunnels.set(id, tunnel);
		return tunnel;
	}

	get tunnels(): any[] {
		return Array.from(this._tunnels.values());
	}
}
