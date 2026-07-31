/**
 * Dardcor Code - Dynamic Remote Port To Local Port Mapping Manager (Task 816)
 */

import { createServer } from 'node:net';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { generateUuid } from '../../core/types/uuid';

export const enum PortMappingStatus {
	Pending = 0,
	Forwarding = 1,
	Failed = 2,
	Closed = 3
}

export interface IPortMapping {
	readonly id: string;
	readonly remotePort: number;
	readonly localPort: number;
	readonly localAddress: string;
	readonly label?: string;
	status: PortMappingStatus;
	readonly createdAt: number;
}

export async function getFreePort(preferredPort?: number, host = '127.0.0.1'): Promise<number> {
	const candidates = preferredPort !== undefined ? [preferredPort, 0] : [0];
	for (const port of candidates) {
		try {
			return await new Promise<number>((resolvePromise, reject) => {
				const server = createServer();
				server.once('error', reject);
				server.listen(port, host, () => {
					const address = server.address();
					const actual = typeof address === 'object' && address ? address.port : port;
					server.close(() => resolvePromise(actual));
				});
			});
		} catch {
			continue;
		}
	}
	throw new Error('Unable to find a free port');
}

export class PortForwardingManager extends Disposable {
	private readonly _mappings = new Map<string, IPortMapping>();

	private readonly _onDidChangePorts = this._register(new Emitter<void>());
	readonly onDidChangePorts: Event<void> = this._onDidChangePorts.event;

	async add(remotePort: number, options: { preferredLocalPort?: number; label?: string; localAddress?: string } = {}): Promise<IPortMapping> {
		const existing = this.findByRemotePort(remotePort);
		if (existing) {
			return existing;
		}
		const localPort = await getFreePort(options.preferredLocalPort, options.localAddress ?? '127.0.0.1');
		const mapping: IPortMapping = {
			id: generateUuid(),
			remotePort,
			localPort,
			localAddress: options.localAddress ?? '127.0.0.1',
			label: options.label,
			status: PortMappingStatus.Pending,
			createdAt: Date.now()
		};
		this._mappings.set(mapping.id, mapping);
		this._onDidChangePorts.fire();
		return mapping;
	}

	remove(id: string): void {
		const mapping = this._mappings.get(id);
		if (!mapping) {
			return;
		}
		this._mappings.delete(id);
		this._onDidChangePorts.fire();
	}

	removeByRemotePort(remotePort: number): void {
		const mapping = this.findByRemotePort(remotePort);
		if (mapping) {
			this.remove(mapping.id);
		}
	}

	setStatus(id: string, status: PortMappingStatus): void {
		const mapping = this._mappings.get(id);
		if (mapping && mapping.status !== status) {
			mapping.status = status;
			this._onDidChangePorts.fire();
		}
	}

	findByRemotePort(remotePort: number): IPortMapping | undefined {
		return [...this._mappings.values()].find(m => m.remotePort === remotePort);
	}

	findByLocalPort(localPort: number): IPortMapping | undefined {
		return [...this._mappings.values()].find(m => m.localPort === localPort);
	}

	list(): IPortMapping[] {
		return [...this._mappings.values()].sort((a, b) => a.remotePort - b.remotePort);
	}

	get count(): number {
		return this._mappings.size;
	}

	override dispose(): void {
		this._mappings.clear();
		super.dispose();
	}
}
