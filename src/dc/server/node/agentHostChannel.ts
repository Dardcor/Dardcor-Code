/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Emitter, Event } from '../../base/common/event.js';
import { Disposable, IDisposable } from '../../base/common/lifecycle.js';
import { connectionTokenQueryName } from '../../base/common/network.js';
import { IPCServer, IServerChannel } from '../../base/parts/ipc/common/ipc.js';
import { ILogService } from '../../platform/log/common/log.js';
import type * as wsTypes from 'ws';
import type * as netTypes from 'net';

const agentHostProxyUnavailableMessage = 'Agent host proxy is not available because no upstream agent host endpoint was configured.';

export interface IAgentHostUpstreamEndpoint {
	readonly host?: string;
	readonly port?: string;
	readonly socketPath?: string;
	readonly connectionToken?: string;
}

let _wsModule: typeof wsTypes | undefined;
async function loadWs(): Promise<typeof wsTypes> {
	return _wsModule ??= await import('ws');
}

let _netModule: typeof netTypes | undefined;
async function loadNet(): Promise<typeof netTypes> {
	return _netModule ??= await import('net');
}

export interface IUpstreamConnection extends IDisposable {
	readonly onFrame: Event<string>;
	readonly onClose: Event<void>;
	connect(): Promise<void>;
	send(frame: string): void;
}

export type UpstreamConnectionFactory = (endpoint: IAgentHostUpstreamEndpoint) => IUpstreamConnection;

export class UnavailableAgentHostChannel<TContext> implements IServerChannel<TContext> {

	listen<T>(_ctx: TContext, event: string): Event<T> {
		switch (event) {
			case 'frame':
			case 'close':
				return Event.None;
		}
		throw new Error(`Invalid listen: ${event}`);
	}

	call<T>(_ctx: TContext, command: string): Promise<T> {
		switch (command) {
			case 'connect':
				return Promise.reject(new Error(agentHostProxyUnavailableMessage));
			case 'send':
			case 'close':
				return Promise.resolve(undefined as T);
		}
		return Promise.reject(new Error(`Invalid call: ${command}`));
	}
}

const defaultUpstreamFactory = (logService: ILogService): UpstreamConnectionFactory =>
	(endpoint) => new WebSocketUpstreamConnection(endpoint, logService);

class WebSocketUpstreamConnection extends Disposable implements IUpstreamConnection {
	private readonly _onFrame = this._register(new Emitter<string>());
	readonly onFrame: Event<string> = this._onFrame.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose: Event<void> = this._onClose.event;

	private _ws: wsTypes.WebSocket | undefined;
	private _connectPromise: Promise<void> | undefined;
	private _closeFired = false;

	constructor(
		private readonly _endpoint: IAgentHostUpstreamEndpoint,
		private readonly _logService: ILogService,
	) {
		super();
	}

	connect(): Promise<void> {
		if (this._store.isDisposed) {
			return Promise.reject(new Error('UpstreamConnection is disposed'));
		}
		return this._connectPromise ??= this._doConnect();
	}

	private async _doConnect(): Promise<void> {
		const ws = await loadWs();
		const url = this._buildUrl();
		const wsOptions = await this._buildWsOptions();

		this._logService.info(`[AgentHostChannel] Opening upstream to ${this._endpoint.socketPath ?? url}`);
		const socket = new ws.WebSocket(url, wsOptions);
		this._ws = socket;

		return new Promise<void>((resolve, reject) => {
			const onOpen = () => {
				cleanup();
				this._logService.trace('[AgentHostChannel] Upstream open');
				socket.on('message', (data: Buffer | string) => {
					const text = typeof data === 'string' ? data : data.toString('utf-8');
					this._onFrame.fire(text);
				});
				socket.on('close', () => this._fireClose());
				socket.on('error', err => {
					this._logService.warn('[AgentHostChannel] Upstream error', err);
					this._fireClose();
				});
				resolve();
			};

			const onError = (err: Error) => {
				cleanup();
				this._logService.warn('[AgentHostChannel] Upstream connection failed', err);
				this._fireClose();
				reject(err);
			};

			const onClose = () => {
				cleanup();
				this._fireClose();
				reject(new Error('Upstream closed before connect'));
			};

			const cleanup = () => {
				socket.removeListener('open', onOpen);
				socket.removeListener('error', onError);
				socket.removeListener('close', onClose);
			};

			socket.on('open', onOpen);
			socket.on('error', onError);
			socket.on('close', onClose);
		});
	}

	send(frame: string): void {
		const ws = this._ws;
		if (!ws || ws.readyState !== ws.OPEN) {
			this._logService.warn('[AgentHostChannel] Drop send: upstream not open');
			this._fireClose();
			return;
		}
		ws.send(frame);
	}

	override dispose(): void {
		this._ws?.close();
		this._fireClose();
		super.dispose();
	}

	private _fireClose(): void {
		if (this._closeFired) {
			return;
		}
		this._closeFired = true;
		this._onClose.fire();
	}

	private _buildUrl(): string {
		const host = this._endpoint.host ?? 'localhost';
		const port = this._endpoint.port ?? '0';
		let url = `ws://${host}:${port}`;
		if (this._endpoint.connectionToken) {
			url += `?${connectionTokenQueryName}=${encodeURIComponent(this._endpoint.connectionToken)}`;
		}
		return url;
	}

	private async _buildWsOptions(): Promise<wsTypes.ClientOptions | undefined> {
		if (!this._endpoint.socketPath) {
			return undefined;
		}
		const net = await loadNet();
		const socketPath = this._endpoint.socketPath;
		const createConnection = (() => net.createConnection(socketPath)) as unknown as wsTypes.ClientOptions['createConnection'];
		return { createConnection } satisfies wsTypes.ClientOptions;
	}
}

export class AgentHostChannel<TContext> extends Disposable implements IServerChannel<TContext> {

	private readonly _perCtx = new Map<TContext, IUpstreamConnection>();
	private readonly _upstreamFactory: UpstreamConnectionFactory;

	constructor(
		ipcServer: IPCServer<TContext>,
		private readonly _endpoint: IAgentHostUpstreamEndpoint,
		private readonly _logService: ILogService,
		upstreamFactory?: UpstreamConnectionFactory,
	) {
		super();
		this._upstreamFactory = upstreamFactory ?? defaultUpstreamFactory(_logService);
		this._register(ipcServer.onDidRemoveConnection(c => this._disposeCtx(c.ctx as unknown as TContext)));
	}

	listen<T>(ctx: TContext, event: string): Event<T> {
		const conn = this._getOrCreate(ctx);
		switch (event) {
			case 'frame': return conn.onFrame as Event<unknown> as Event<T>;
			case 'close': return conn.onClose as Event<unknown> as Event<T>;
		}
		throw new Error(`Invalid listen: ${event}`);
	}

	async call<T>(ctx: TContext, command: string, arg?: unknown): Promise<T> {
		const conn = this._getOrCreate(ctx);
		switch (command) {
			case 'connect':
				this._logService.info(`[AgentHostChannel] Renderer ctx=${String(ctx)} requested connect to upstream`);
				await conn.connect();
				return undefined as T;
			case 'send':
				if (typeof arg !== 'string') {
					throw new Error('send: arg must be a string frame');
				}
				conn.send(arg);
				return undefined as T;
			case 'close':
				this._disposeCtx(ctx);
				return undefined as T;
		}
		throw new Error(`Invalid call: ${command}`);
	}

	override dispose(): void {
		for (const conn of this._perCtx.values()) {
			conn.dispose();
		}
		this._perCtx.clear();
		super.dispose();
	}

	private _getOrCreate(ctx: TContext): IUpstreamConnection {
		let conn = this._perCtx.get(ctx);
		if (!conn) {
			conn = this._upstreamFactory(this._endpoint);
			this._perCtx.set(ctx, conn);
			const sub = conn.onClose(() => {
				sub.dispose();
				if (this._perCtx.get(ctx) === conn) {
					this._perCtx.delete(ctx);
				}
			});
		}
		return conn;
	}

	private _disposeCtx(ctx: TContext): void {
		const conn = this._perCtx.get(ctx);
		if (conn) {
			this._perCtx.delete(ctx);
			conn.dispose();
		}
	}
}
