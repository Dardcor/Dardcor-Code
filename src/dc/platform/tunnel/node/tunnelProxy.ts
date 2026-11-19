/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import { Duplex } from 'stream';
import type * as http from 'http';
import type * as https from 'https';

import { findFreePortFaster } from '../../../base/node/ports.js';
import { NodeSocket } from '../../../base/parts/ipc/node/ipc.net.js';
import { ISocket, SocketCloseEventType } from '../../../base/parts/ipc/common/ipc.net.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Limiter } from '../../../base/common/async.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { ITunnelProxyInfo } from '../common/tunnelProxy.js';
import { generateSelfSignedCert } from './selfSignedCert.js';

const MAX_CONCURRENT_TUNNEL_CONNECTS = 6;

export interface ITunnelConnectFn {
	(host: string, port: number): Promise<{ getSocket(): ISocket; readEntireBuffer(): VSBuffer; dispose(): void }>;
}

export class TunnelProxy extends Disposable {

	private _server: https.Server | undefined;
	private _http: typeof http | undefined;
	private _tunnelAgent: http.Agent | undefined;
	private _localPort: number = 0;
	private _credentials: { username: string; password: string } | undefined;
	private _expectedAuthHeader: string | undefined;
	private _certFingerprint: string | undefined;

	private readonly _connectSockets = new Set<net.Socket>();

	private readonly _remoteSockets = new Set<Duplex>();

	private readonly _connectLimiter = this._register(new Limiter<Awaited<ReturnType<ITunnelConnectFn>>>(MAX_CONCURRENT_TUNNEL_CONNECTS));

	get localPort(): number {
		return this._localPort;
	}

	constructor(
		private readonly _connectTunnel: ITunnelConnectFn,
		private readonly _logService: ILogService,
	) {
		super();
	}

	async start(): Promise<ITunnelProxyInfo> {
		const crypto = await import('crypto');
		const http = await import('http');
		const https = await import('https');

		const username = crypto.randomBytes(16).toString('hex');
		const password = crypto.randomBytes(32).toString('hex');
		this._credentials = { username, password };
		this._expectedAuthHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

		const { key, cert, fingerprint } = await generateSelfSignedCert();
		this._certFingerprint = fingerprint;

		this._http = http;
		this._tunnelAgent = this._createTunnelAgent();

		const server = https.createServer({ key, cert }, (req, res) => this._onRequest(req, res));
		server.on('connect', (req, socket, head) => this._onConnect(req, socket as net.Socket, head));
		server.on('error', err => {
			this._logService.error('[TunnelProxy] Server error:', err);
		});
		this._server = server;

		const port = await findFreePortFaster(0, 2, 1000, '127.0.0.1');
		server.listen(port, '127.0.0.1');
		await new Promise<void>((resolve, reject) => {
			server.once('listening', resolve);
			server.once('error', reject);
		});
		const address = server.address() as net.AddressInfo;
		this._localPort = address.port;
		this._logService.info(`[TunnelProxy] Listening on https://127.0.0.1:${this._localPort}`);

		return {
			url: `https://127.0.0.1:${this._localPort}`,
			host: '127.0.0.1',
			port: this._localPort,
			credentials: this._credentials,
			certFingerprint: this._certFingerprint,
		};
	}

	override dispose(): void {
		for (const socket of this._connectSockets) {
			socket.destroy();
		}
		this._connectSockets.clear();
		for (const socket of this._remoteSockets) {
			socket.destroy();
		}
		this._remoteSockets.clear();
		this._tunnelAgent?.destroy();
		this._server?.closeAllConnections();
		this._server?.close();
		super.dispose();
	}

	private _checkAuth(authHeader: string | undefined): boolean {
		return authHeader === this._expectedAuthHeader;
	}

	private _createTunnelAgent(): http.Agent {
		if (!this._http) {
			throw new Error('HTTP module not initialized');
		}
		const agent = new this._http.Agent({ keepAlive: true });
		agent.createConnection = (options, oncreate) => {
			const host = options.hostname || options.host || '';
			const port = Number(options.port) || 80;
			this._createTunnelSocket(host, port)
				.then(socket => oncreate?.(null, socket))
				.catch(err => oncreate?.(err, null!));
		};
		return agent;
	}

	drainConnectionPool(): void {
		if (!this._tunnelAgent) {
			return;
		}
		const oldAgent = this._tunnelAgent;
		this._tunnelAgent = this._createTunnelAgent();
		oldAgent?.destroy();
		this._logService.trace('[TunnelProxy] Upstream endpoint changed; drained pooled tunnel sockets');
	}

	private async _onConnect(req: http.IncomingMessage, socket: net.Socket, head: Buffer): Promise<void> {
		this._connectSockets.add(socket);
		socket.on('close', () => this._connectSockets.delete(socket));

		if (!this._checkAuth(req.headers['proxy-authorization'])) {
			socket.write(
				'HTTP/1.1 407 Proxy Authentication Required\r\n' +
				'Proxy-Authenticate: Basic realm="TunnelProxy"\r\n' +
				'\r\n'
			);
			socket.end();
			return;
		}

		const { host, port } = this._parseHostPort(req.url ?? '', 443);
		if (!host) {
			socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
			socket.end();
			return;
		}

		this._logService.trace(`[TunnelProxy] CONNECT ${host}:${port}`);

		try {
			socket.pause();

			const protocol = await this._connectLimiter.queue(() => this._connectTunnel(host, port));
			const { stream: remoteSocket, leftover } = this._takeRemoteStream(protocol);

			socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

			if (leftover.byteLength > 0) {
				socket.write(leftover.buffer);
			}

			if (head.length > 0) {
				remoteSocket.write(head);
			}

			this._bridgeSockets(socket, remoteSocket);
		} catch (err) {
			this._logService.error(`[TunnelProxy] Failed to tunnel to ${host}:${port}:`, err);
			socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
			socket.end();
		}
	}

	private async _onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (!this._checkAuth(req.headers['proxy-authorization'])) {
			res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="TunnelProxy"' });
			res.end();
			return;
		}

		let parsed: URL;
		try {
			parsed = new URL(req.url ?? '');
		} catch {
			res.writeHead(400);
			res.end();
			return;
		}

		if (parsed.protocol !== 'http:') {
			this._logService.warn(`[TunnelProxy] Rejecting non-HTTP forwarded request: ${req.method} ${req.url}`);
			res.writeHead(400);
			res.end();
			return;
		}

		const host = parsed.hostname;
		const port = parseInt(parsed.port, 10) || 80;

		if (!host) {
			res.writeHead(400);
			res.end();
			return;
		}

		this._logService.trace(`[TunnelProxy] ${req.method} ${host}:${port}${parsed.pathname}`);

		try {
			const http = await import('http');
			const path = parsed.pathname + parsed.search;
			const headers = { ...req.headers };

			const connectionTokens = (headers['connection'] ?? '')
				.toString()
				.split(',')
				.map(t => t.trim().toLowerCase())
				.filter(t => t.length > 0);
			for (const token of connectionTokens) {
				delete headers[token];
			}
			delete headers['connection'];
			delete headers['keep-alive'];
			delete headers['proxy-authorization'];
			delete headers['proxy-connection'];
			delete headers['te'];
			delete headers['transfer-encoding'];
			delete headers['upgrade'];

			const proxyReq = http.request({
				agent: this._tunnelAgent,
				hostname: host,
				port,
				path,
				method: req.method,
				headers,
			}, proxyRes => {
				res.writeHead(proxyRes.statusCode!, proxyRes.headers);
				proxyRes.pipe(res);
			});

			proxyReq.on('error', err => {
				this._logService.error(`[TunnelProxy] Proxy request error for ${host}:${port}:`, err);
				res.destroy();
			});

			req.pipe(proxyReq);
		} catch (err) {
			this._logService.error(`[TunnelProxy] Failed to tunnel to ${host}:${port}:`, err);
			res.destroy();
		}
	}

	private async _createTunnelSocket(host: string, port: number): Promise<Duplex> {
		const protocol = await this._connectLimiter.queue(() => this._connectTunnel(host, port));
		const { stream: tunnelStream, leftover } = this._takeRemoteStream(protocol);

		this._trackRemoteSocket(tunnelStream);

		if (leftover.byteLength > 0) {
			tunnelStream.unshift(leftover.buffer);
		}

		return tunnelStream;
	}

	private _takeRemoteStream(protocol: { getSocket(): ISocket; readEntireBuffer(): VSBuffer; dispose(): void }): { stream: Duplex; leftover: VSBuffer } {
		const remoteSocket = protocol.getSocket();

		if (remoteSocket instanceof NodeSocket) {
			const socket = remoteSocket.socket;
			const leftover = protocol.readEntireBuffer();
			remoteSocket.dispose(false);
			protocol.dispose();
			return { stream: socket, leftover };
		}

		const leftover = protocol.readEntireBuffer();
		protocol.dispose();
		return { stream: new RemoteSocketStream(remoteSocket), leftover };
	}

	private _parseHostPort(address: string, defaultPort: number): { host: string; port: number } {
		let host: string;
		let port: number;

		const bracketMatch = /^\[(?<host>[^\]]+)\]:(?<port>\d+)$/.exec(address);
		if (bracketMatch?.groups) {
			host = bracketMatch.groups['host'];
			port = parseInt(bracketMatch.groups['port'], 10);
		} else {
			const bracketOnly = /^\[(?<host>[^\]]+)\]$/.exec(address);
			if (bracketOnly?.groups) {
				host = bracketOnly.groups['host'];
				port = defaultPort;
			} else {
				const lastColon = address.lastIndexOf(':');
				if (lastColon === -1) {
					host = address;
					port = defaultPort;
				} else {
					const maybePort = parseInt(address.substring(lastColon + 1), 10);
					if (isNaN(maybePort)) {
						host = address;
						port = defaultPort;
					} else {
						host = address.substring(0, lastColon);
						port = maybePort;
					}
				}
			}
		}

		if (port < 1 || port > 65535) {
			return { host: '', port: 0 };
		}

		return { host, port };
	}

	private _bridgeSockets(localSocket: net.Socket, remoteSocket: Duplex): void {
		this._trackRemoteSocket(remoteSocket);
		remoteSocket.on('end', () => localSocket.end());
		remoteSocket.on('close', () => localSocket.end());
		remoteSocket.on('error', () => localSocket.destroy());
		localSocket.on('end', () => remoteSocket.end());
		localSocket.on('close', () => remoteSocket.end());
		localSocket.on('error', () => remoteSocket.destroy());

		remoteSocket.pipe(localSocket);
		localSocket.pipe(remoteSocket);
	}

	private _trackRemoteSocket(socket: Duplex): void {
		this._remoteSockets.add(socket);

		socket.on('error', () => socket.destroy());
		socket.on('close', () => this._remoteSockets.delete(socket));
	}
}

class RemoteSocketStream extends Duplex {

	private readonly _disposables = new DisposableStore();

	constructor(private readonly _socket: ISocket) {
		super();
		this._disposables.add(this._socket.onData(data => this.push(data.buffer)));
		this._disposables.add(this._socket.onEnd(() => this.push(null)));
		this._disposables.add(this._socket.onClose(e => {
			this.destroy(e?.type === SocketCloseEventType.NodeSocketCloseEvent ? e.error : undefined);
		}));
	}

	setKeepAlive(): this { return this; }
	setNoDelay(): this { return this; }
	setTimeout(): this { return this; }
	ref(): this { return this; }
	unref(): this { return this; }

	override _read(): void {
	}

	override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
		this._socket.write(VSBuffer.wrap(chunk));
		this._socket.drain().then(() => callback(), err => callback(err));
	}

	override _final(callback: (error?: Error | null) => void): void {
		this._socket.end();
		callback();
	}

	override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
		this._disposables.dispose();
		this._socket.dispose();
		callback(error);
	}
}
