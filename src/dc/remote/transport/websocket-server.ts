/**
 * Dardcor Code - Minimal RFC6455 WebSocket Server Over node:http (Task 802)
 */

import http from 'node:http';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const enum WsOpcode {
	Continuation = 0x0,
	Text = 0x1,
	Binary = 0x2,
	Close = 0x8,
	Ping = 0x9,
	Pong = 0xa
}

export const enum WsCloseCode {
	Normal = 1000,
	GoingAway = 1001,
	ProtocolError = 1002,
	UnsupportedData = 1003,
	NoStatus = 1005,
	Abnormal = 1006,
	InvalidPayload = 1007,
	PolicyViolation = 1008,
	MessageTooBig = 1009,
	MandatoryExtension = 1010,
	InternalError = 1011
}

export interface IWebSocketServerOptions {
	readonly path?: string;
	readonly maxPayloadBytes?: number;
}

export interface IWebSocketCloseInfo {
	readonly code: number;
	readonly reason: string;
	readonly wasClean: boolean;
}

interface IParsedFrame {
	readonly fin: boolean;
	readonly opcode: WsOpcode;
	readonly payload: Buffer;
}

export class WebSocketConnection extends Disposable {
	private readonly _socket: Socket;
	private readonly _maxPayloadBytes: number;

	private _incoming: Buffer = Buffer.alloc(0);
	private _messageBuffer: Buffer | null = null;
	private _messageOpcode: WsOpcode = WsOpcode.Binary;
	private _closeSent = false;
	private _closed = false;

	private readonly _onMessage = this._register(new Emitter<Uint8Array>());
	readonly onMessage: Event<Uint8Array> = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<IWebSocketCloseInfo>());
	readonly onClose: Event<IWebSocketCloseInfo> = this._onClose.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	private readonly _onPong = this._register(new Emitter<Uint8Array>());
	readonly onPong: Event<Uint8Array> = this._onPong.event;

	constructor(socket: Socket, maxPayloadBytes = 16 * 1024 * 1024) {
		super();
		this._socket = socket;
		this._maxPayloadBytes = maxPayloadBytes;
		this._register({
			dispose: () => {
				socket.removeListener('data', this._onData);
				socket.removeListener('end', this._onEnd);
				socket.removeListener('error', this._onSocketError);
				socket.removeListener('close', this._onSocketClose);
			}
		});
		socket.on('data', this._onData);
		socket.on('end', this._onEnd);
		socket.on('error', this._onSocketError);
		socket.on('close', this._onSocketClose);
	}

	get readyState(): 'open' | 'closing' | 'closed' {
		if (this._closed) {
			return 'closed';
		}
		if (this._closeSent) {
			return 'closing';
		}
		return 'open';
	}

	send(data: Uint8Array | string): boolean {
		if (this._closed || this._closeSent) {
			return false;
		}
		try {
			const isBinary = typeof data !== 'string';
			const payload = isBinary ? Buffer.from(data) : Buffer.from(data, 'utf8');
			this._socket.write(encodeServerFrame(isBinary ? WsOpcode.Binary : WsOpcode.Text, payload));
			return true;
		} catch {
			return false;
		}
	}

	ping(payload: Uint8Array = new Uint8Array(0)): void {
		if (this._closed || this._closeSent) {
			return;
		}
		this._socket.write(encodeServerFrame(WsOpcode.Ping, Buffer.from(payload)));
	}

	close(code: number = WsCloseCode.Normal, reason: string = ''): void {
		if (this._closed) {
			return;
		}
		this._closeSent = true;
		const reasonBuffer = Buffer.from(reason, 'utf8').subarray(0, 123);
		const payload = Buffer.alloc(2 + reasonBuffer.length);
		payload.writeUInt16BE(code, 0);
		reasonBuffer.copy(payload, 2);
		try {
			this._socket.write(encodeServerFrame(WsOpcode.Close, payload));
		} catch {
			// ignore
		}
		this._socket.end();
	}

	private readonly _onData = (chunk: Buffer): void => {
		this._incoming = Buffer.concat([this._incoming, chunk]);
		this._drain();
	};

	private readonly _onEnd = (): void => {
		this._terminate(WsCloseCode.Abnormal, 'connection ended', false);
	};

	private readonly _onSocketError = (error: Error): void => {
		this._onError.fire(error);
	};

	private readonly _onSocketClose = (): void => {
		this._terminate(WsCloseCode.Abnormal, '', false);
	};

	private _drain(): void {
		for (;;) {
			const frame = this._tryParseFrame();
			if (!frame) {
				return;
			}
			this._handleFrame(frame);
		}
	}

	private _tryParseFrame(): IParsedFrame | undefined {
		const buf = this._incoming;
		if (buf.length < 2) {
			return undefined;
		}
		const b0 = buf[0];
		const b1 = buf[1];
		const fin = (b0 & 0x80) !== 0;
		const opcode = (b0 & 0x0f) as WsOpcode;
		const masked = (b1 & 0x80) !== 0;
		let length = b1 & 0x7f;
		let offset = 2;

		if (length === 126) {
			if (buf.length < 4) {
				return undefined;
			}
			length = buf.readUInt16BE(2);
			offset = 4;
		} else if (length === 127) {
			if (buf.length < 10) {
				return undefined;
			}
			const high = buf.readUInt32BE(2);
			const low = buf.readUInt32BE(6);
			if (high !== 0) {
				this._fail(WsCloseCode.MessageTooBig, 'message too large');
				return undefined;
			}
			length = low;
			offset = 10;
		}

		if (length > this._maxPayloadBytes) {
			this._fail(WsCloseCode.MessageTooBig, 'message exceeds max payload');
			return undefined;
		}

		let maskKey: Buffer | undefined;
		if (masked) {
			if (buf.length < offset + 4) {
				return undefined;
			}
			maskKey = buf.subarray(offset, offset + 4);
			offset += 4;
		}

		if (buf.length < offset + length) {
			return undefined;
		}

		let payload = Buffer.from(buf.subarray(offset, offset + length));
		if (masked && maskKey) {
			for (let i = 0; i < payload.length; i++) {
				payload[i] ^= maskKey[i % 4];
			}
		}
		this._incoming = Buffer.from(buf.subarray(offset + length));
		return { fin, opcode, payload };
	}

	private _handleFrame(frame: IParsedFrame): void {
		switch (frame.opcode) {
			case WsOpcode.Text:
			case WsOpcode.Binary:
				if (!frame.fin) {
					this._messageBuffer = frame.payload;
					this._messageOpcode = frame.opcode;
					return;
				}
				this._onMessage.fire(new Uint8Array(frame.payload));
				return;
			case WsOpcode.Continuation:
				if (!this._messageBuffer) {
					this._fail(WsCloseCode.ProtocolError, 'unexpected continuation frame');
					return;
				}
				if (this._messageBuffer.length + frame.payload.length > this._maxPayloadBytes) {
					this._fail(WsCloseCode.MessageTooBig, 'message exceeds max payload');
					return;
				}
				this._messageBuffer = Buffer.concat([this._messageBuffer, frame.payload]);
				if (frame.fin) {
					const message = Buffer.from(this._messageBuffer);
					const opcode = this._messageOpcode;
					this._messageBuffer = null;
					this._onMessage.fire(new Uint8Array(message));
					void opcode;
				}
				return;
			case WsOpcode.Ping:
				this._socket.write(encodeServerFrame(WsOpcode.Pong, frame.payload));
				return;
			case WsOpcode.Pong:
				this._onPong.fire(new Uint8Array(frame.payload));
				return;
			case WsOpcode.Close:
				this._handleCloseFrame(frame.payload);
				return;
			default:
				this._fail(WsCloseCode.ProtocolError, `unsupported opcode 0x${(frame.opcode as number).toString(16)}`);
		}
	}

	private _handleCloseFrame(payload: Buffer): void {
		let code = WsCloseCode.NoStatus;
		let reason = '';
		if (payload.length >= 2) {
			code = payload.readUInt16BE(0);
			reason = payload.subarray(2).toString('utf8');
		}
		if (!this._closeSent) {
			this._closeSent = true;
			try {
				this._socket.write(encodeServerFrame(WsOpcode.Close, payload));
			} catch {
				// ignore
			}
		}
		this._terminate(code, reason, true);
	}

	private _fail(code: WsCloseCode, reason: string): void {
		this._onError.fire(new Error(`WebSocket protocol error: ${reason}`));
		this.close(code, reason);
	}

	private _terminate(code: number, reason: string, wasClean: boolean): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._socket.removeListener('data', this._onData);
		this._socket.removeListener('end', this._onEnd);
		this._socket.removeListener('error', this._onSocketError);
		this._socket.removeListener('close', this._onSocketClose);
		try {
			this._socket.end();
			this._socket.destroy();
		} catch {
			// ignore
		}
		this._onClose.fire({ code, reason, wasClean });
	}
}

function encodeServerFrame(opcode: WsOpcode, payload: Buffer): Buffer {
	const length = payload.length;
	let header: Buffer;
	if (length < 126) {
		header = Buffer.alloc(2);
		header[0] = 0x80 | opcode;
		header[1] = length;
	} else if (length < 65536) {
		header = Buffer.alloc(4);
		header[0] = 0x80 | opcode;
		header[1] = 126;
		header.writeUInt16BE(length, 2);
	} else {
		header = Buffer.alloc(10);
		header[0] = 0x80 | opcode;
		header[1] = 127;
		header.writeUInt32BE(0, 2);
		header.writeUInt32BE(length, 6);
	}
	return Buffer.concat([header, payload]);
}

function computeAcceptKey(websocketKey: string): string {
	return createHash('sha1').update(websocketKey + WEBSOCKET_GUID).digest('base64');
}

export class WebSocketServer extends Disposable {
	private readonly _path: string;
	private readonly _maxPayloadBytes: number;
	private readonly _httpServer: http.Server;

	private readonly _connections = new Set<WebSocketConnection>();

	private readonly _onConnection = this._register(new Emitter<WebSocketConnection>());
	readonly onConnection: Event<WebSocketConnection> = this._onConnection.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	private readonly _onUpgradeRejected = this._register(new Emitter<{ request: http.IncomingMessage; reason: string }>());
	readonly onUpgradeRejected: Event<{ request: http.IncomingMessage; reason: string }> = this._onUpgradeRejected.event;

	constructor(httpServer: http.Server, options: IWebSocketServerOptions = {}) {
		super();
		this._httpServer = httpServer;
		this._path = options.path ?? '/';
		this._maxPayloadBytes = options.maxPayloadBytes ?? 16 * 1024 * 1024;
		httpServer.on('upgrade', this._onUpgrade);
		this._register({
			dispose: () => {
				httpServer.removeListener('upgrade', this._onUpgrade);
			}
		});
	}

	get connectionCount(): number {
		return this._connections.size;
	}

	get connections(): ReadonlySet<WebSocketConnection> {
		return this._connections;
	}

	acceptConnection(request: http.IncomingMessage, socket: Socket): WebSocketConnection {
		const connection = new WebSocketConnection(socket, this._maxPayloadBytes);
		this._connections.add(connection);
		connection.onClose(() => this._connections.delete(connection));
		this._onConnection.fire(connection);
		return connection;
	}

	private readonly _onUpgrade = (request: http.IncomingMessage, socket: Socket, head: Buffer): void => {
		const reject = (reason: string): void => {
			this._onUpgradeRejected.fire({ request, reason });
			try {
				socket.write(
					'HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
				);
			} catch {
				// ignore
			}
			socket.destroy();
		};

		if (head.length > 0) {
			reject('unexpected upgrade payload');
			return;
		}
		const url = request.url ?? '/';
		const pathOnly = url.split('?')[0];
		if (pathOnly !== this._path) {
			reject(`unexpected upgrade path '${pathOnly}' (expected '${this._path}')`);
			return;
		}
		const upgrade = (request.headers.upgrade ?? '').toLowerCase();
		if (upgrade !== 'websocket') {
			reject(`invalid upgrade header '${upgrade}'`);
			return;
		}
		const key = request.headers['sec-websocket-key'];
		if (typeof key !== 'string' || key.length === 0) {
			reject('missing Sec-WebSocket-Key');
			return;
		}
		const version = request.headers['sec-websocket-version'];
		if (version !== '13') {
			reject(`unsupported Sec-WebSocket-Version '${version}'`);
			return;
		}

		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\n' +
			'Upgrade: websocket\r\n' +
			'Connection: Upgrade\r\n' +
			`Sec-WebSocket-Accept: ${computeAcceptKey(key)}\r\n\r\n`
		);

		const connection = this.acceptConnection(request, socket);
		void connection;
	};

	override dispose(): void {
		for (const connection of [...this._connections]) {
			connection.close(WsCloseCode.GoingAway, 'server shutting down');
		}
		this._connections.clear();
		super.dispose();
	}
}
