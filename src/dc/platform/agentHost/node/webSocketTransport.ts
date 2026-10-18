/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Emitter } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { connectionTokenQueryName } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IInstantiationService } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { AhpJsonlLogger, getAhpLogByteLength } from '../common/ahpJsonlLogger.js';
import { AgentHostTransportKind } from '../common/agentHostTelemetry.js';
import { JSON_RPC_PARSE_ERROR, type AhpServerNotification, type JsonRpcNotification, type JsonRpcParseErrorResponse, type JsonRpcRequest, type JsonRpcResponse, type ProtocolMessage } from '../common/state/sessionProtocol.js';
import type { IProtocolServer, IProtocolTransport } from '../common/state/sessionTransport.js';
import type * as wsTypes from 'ws';
import type * as httpTypes from 'http';

export interface IWebSocketServerOptions {
	readonly port?: number;
	readonly host?: string;
	readonly socketPath?: string;
	readonly connectionTokenValidate?: (token: unknown) => boolean;
}


export class WebSocketProtocolTransport extends Disposable implements IProtocolTransport {
	readonly transportKind = AgentHostTransportKind.WebSocket;

	private readonly _onMessage = this._register(new Emitter<ProtocolMessage>());
	readonly onMessage = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	constructor(
		private readonly _ws: wsTypes.WebSocket,
		private readonly _WebSocket: typeof wsTypes.WebSocket,
		private readonly _ahpLogger?: AhpJsonlLogger,
	) {
		super();
		if (this._ahpLogger) {
			this._register(this._ahpLogger);
		}

		this._ws.on('message', (data: Buffer | string) => {
			try {
				const text = typeof data === 'string' ? data : data.toString('utf-8');
				const message = JSON.parse(text) as ProtocolMessage;
				this._ahpLogger?.log(message, 'c2s', getAhpLogByteLength(text));
				this._onMessage.fire(message);
			} catch {
				this.send({ jsonrpc: '2.0', id: null, error: { code: JSON_RPC_PARSE_ERROR, message: 'Parse error' } });
			}
		});

		this._ws.on('close', () => {
			this._onClose.fire();
		});

		this._ws.on('error', () => {
			this._onClose.fire();
		});
	}

	send(message: ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcParseErrorResponse | JsonRpcResponse | JsonRpcRequest): void {
		if (this._ws.readyState === this._WebSocket.OPEN) {
			const text = JSON.stringify(message);
			this._ahpLogger?.log(message, 's2c', getAhpLogByteLength(text));
			this._ws.send(text);
		}
	}

	override dispose(): void {
		this._ws.close();
		super.dispose();
	}
}


export class WebSocketProtocolServer extends Disposable implements IProtocolServer {

	private readonly _wss: wsTypes.WebSocketServer;
	private readonly _httpServer: httpTypes.Server | undefined;
	private readonly _WebSocket: typeof wsTypes.WebSocket;
	private _connectionCount = 0;

	private readonly _onConnection = this._register(new Emitter<IProtocolTransport>());
	readonly onConnection = this._onConnection.event;

	readonly whenListening: Promise<void>;

	get address(): string | undefined {
		const addr = this._wss.address();
		if (!addr || typeof addr === 'string') {
			return addr ?? undefined;
		}
		return `${addr.address}:${addr.port}`;
	}

	get boundPort(): number | undefined {
		const addr = this._wss.address();
		if (!addr || typeof addr === 'string') {
			return undefined;
		}
		return addr.port;
	}

	static async create(
		options: IWebSocketServerOptions | number,
		logService: ILogService,
		ahpLogOptions?: { readonly instantiationService: IInstantiationService; readonly logsHome: URI },
	): Promise<WebSocketProtocolServer> {
		const [ws, http] = await Promise.all([
			import('ws'),
			import('http'),
		]);
		return new WebSocketProtocolServer(options, logService, ahpLogOptions, ws, http);
	}

	private constructor(
		options: IWebSocketServerOptions | number,
		private readonly _logService: ILogService,
		private readonly _ahpLogOptions: { readonly instantiationService: IInstantiationService; readonly logsHome: URI } | undefined,
		ws: typeof wsTypes,
		http: typeof httpTypes,
	) {
		super();

		this._WebSocket = ws.WebSocket;

		const opts: IWebSocketServerOptions = typeof options === 'number' ? { port: options } : options;
		const host = opts.host ?? '127.0.0.1';

		const verifyClient = opts.connectionTokenValidate
			? (info: { req: httpTypes.IncomingMessage }, cb: (res: boolean, code?: number, message?: string) => void) => {
				let tokens: string[];
				try {
					tokens = new URL(info.req.url ?? '', 'http://localhost').searchParams.getAll(connectionTokenQueryName);
				} catch {
					this._logService.warn('[WebSocketProtocol] Connection rejected: invalid request URL');
					cb(false, 400, 'Bad Request');
					return;
				}
				const token = tokens.length > 1 ? tokens : tokens[0];
				if (!opts.connectionTokenValidate!(token)) {
					this._logService.warn('[WebSocketProtocol] Connection rejected: invalid connection token');
					cb(false, 403, 'Forbidden');
					return;
				}
				cb(true);
			}
			: undefined;

		if (opts.socketPath) {
			this._httpServer = http.createServer();
			this._wss = new ws.WebSocketServer({ server: this._httpServer, verifyClient });
			const httpServer = this._httpServer;
			this.whenListening = new Promise<void>((resolve, reject) => {
				httpServer.once('listening', () => {
					this._logService.info(`[WebSocketProtocol] Server listening on socket ${opts.socketPath}`);
					resolve();
				});
				httpServer.once('error', reject);
			});
			this._httpServer.listen(opts.socketPath);
		} else {
			this._wss = new ws.WebSocketServer({ port: opts.port, host, verifyClient });
			const wss = this._wss;
			this.whenListening = new Promise<void>((resolve, reject) => {
				wss.once('listening', () => {
					const addr = wss.address();
					const bound = !addr || typeof addr === 'string' ? `${host}:${opts.port}` : `${addr.address}:${addr.port}`;
					this._logService.info(`[WebSocketProtocol] Server listening on ${bound}`);
					resolve();
				});
				wss.once('error', reject);
			});
		}

		this._wss.on('connection', (wsConn) => {
			this._logService.trace('[WebSocketProtocol] New client connection');
			const transport = new WebSocketProtocolTransport(wsConn, this._WebSocket, this._createAhpLogger());
			this._onConnection.fire(transport);
		});

		this._wss.on('error', (err) => {
			this._logService.error('[WebSocketProtocol] Server error', err);
		});
	}

	private _createAhpLogger(): AhpJsonlLogger | undefined {
		if (!this._ahpLogOptions) {
			return undefined;
		}
		return this._ahpLogOptions.instantiationService.createInstance(
			AhpJsonlLogger,
			{
				logsHome: this._ahpLogOptions.logsHome,
				connectionId: `agent-host-${++this._connectionCount}-${generateUuid()}`,
				transport: 'websocket',
			},
		);
	}

	override dispose(): void {
		this._wss.close();
		this._httpServer?.close();
		super.dispose();
	}
}
