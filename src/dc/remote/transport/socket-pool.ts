import net from 'node:net';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';

export interface ISocketPoolOptions {
	readonly maxPoolSize?: number;
	readonly maxSocketsPerKey?: number;
	readonly connectTimeoutMs?: number;
	readonly idleTimeoutMs?: number;
	readonly keepAlive?: boolean;
}

export interface ISocketPoolKey {
	readonly host: string;
	readonly port: number;
}

export class SocketPool extends Disposable {
	private readonly _pools = new Map<string, net.Socket[]>();
	private readonly _maxPoolSize: number;
	private readonly _maxSocketsPerKey: number;
	private readonly _connectTimeoutMs: number;
	private readonly _idleTimeoutMs: number;
	private readonly _keepAlive: boolean;

	private _totalCreated = 0;
	private _totalAcquired = 0;
	private _totalReleased = 0;

	private readonly _onIdle = this._register(new Emitter<{ key: string; sockets: number }>());
	readonly onIdle: Event<{ key: string; sockets: number }> = this._onIdle.event;

	constructor(options: ISocketPoolOptions = {}) {
		super();
		this._maxPoolSize = options.maxPoolSize ?? 100;
		this._maxSocketsPerKey = options.maxSocketsPerKey ?? 10;
		this._connectTimeoutMs = options.connectTimeoutMs ?? 5000;
		this._idleTimeoutMs = options.idleTimeoutMs ?? 60000;
		this._keepAlive = options.keepAlive ?? true;
	}

	get size(): number {
		let count = 0;
		for (const pool of this._pools.values()) {
			count += pool.length;
		}
		return count;
	}

	get stats(): { created: number; acquired: number; released: number; pooled: number } {
		return {
			created: this._totalCreated,
			acquired: this._totalAcquired,
			released: this._totalReleased,
			pooled: this.size
		};
	}

	key(host: string, port: number): string {
		return `${host}:${port}`;
	}

	isPooled(host: string, port: number): boolean {
		return (this._pools.get(this.key(host, port))?.length ?? 0) > 0;
	}

	async acquire(host: string, port: number): Promise<net.Socket> {
		const key = this.key(host, port);
		const pool = this._pools.get(key) ?? [];
		const socket = pool.pop();
		if (socket) {
			if (pool.length === 0) {
				this._pools.delete(key);
			}
			this._totalAcquired++;
			return socket;
		}
		const created = await this._connect(host, port);
		this._totalCreated++;
		this._totalAcquired++;
		return created;
	}

	async acquireOrCreate(host: string, port: number): Promise<net.Socket> {
		return this.acquire(host, port);
	}

	release(socket: net.Socket): void {
		if (socket.destroyed || !socket.remoteAddress) {
			socket.destroy();
			return;
		}
		const key = this.key(socket.remoteAddress, socket.remotePort ?? 0);
		if (this.size >= this._maxPoolSize) {
			socket.destroy();
			return;
		}
		const pool = this._pools.get(key) ?? [];
		if (pool.length >= this._maxSocketsPerKey) {
			socket.destroy();
			return;
		}
		if (socket.readableEnded || socket.writableEnded) {
			socket.destroy();
			return;
		}
		this._totalReleased++;
		pool.push(socket);
		this._pools.set(key, pool);
		socket.setTimeout(this._idleTimeoutMs, () => {
			this._removeIdleSocket(key, socket);
		});
	}

	drain(): void {
		for (const [key, pool] of this._pools) {
			for (const socket of pool) {
				socket.destroy();
			}
			this._onIdle.fire({ key, sockets: 0 });
		}
		this._pools.clear();
	}

	drainKey(host: string, port: number): number {
		const key = this.key(host, port);
		const pool = this._pools.get(key);
		if (!pool) {
			return 0;
		}
		const count = pool.length;
		for (const socket of pool) {
			socket.destroy();
		}
		this._pools.delete(key);
		this._onIdle.fire({ key, sockets: 0 });
		return count;
	}

	list(): Array<{ key: string; sockets: net.Socket[] }> {
		return [...this._pools.entries()].map(([key, sockets]) => ({ key, sockets: [...sockets] }));
	}

	getAvailableCount(host: string, port: number): number {
		return this._pools.get(this.key(host, port))?.length ?? 0;
	}

	hasIdleSockets(): boolean {
		return this.size > 0;
	}

	override dispose(): void {
		this.drain();
		super.dispose();
	}

	private _removeIdleSocket(key: string, socket: net.Socket): void {
		const pool = this._pools.get(key);
		if (!pool) {
			return;
		}
		const index = pool.indexOf(socket);
		if (index !== -1) {
			pool.splice(index, 1);
			socket.destroy();
		}
		if (pool.length === 0) {
			this._pools.delete(key);
		}
		this._onIdle.fire({ key, sockets: pool.length });
	}

	private _connect(host: string, port: number): Promise<net.Socket> {
		return new Promise((resolvePromise, reject) => {
			const socket = net.createConnection({ host, port, keepAlive: this._keepAlive });
			let settled = false;
			const timer = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				socket.destroy();
				reject(new Error(`Socket connect to ${host}:${port} timed out after ${this._connectTimeoutMs}ms`));
			}, this._connectTimeoutMs);
			socket.once('connect', () => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolvePromise(socket);
			});
			socket.once('error', error => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				reject(error);
			});
		});
	}
}
