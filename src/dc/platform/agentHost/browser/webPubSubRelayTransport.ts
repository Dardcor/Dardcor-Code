/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Emitter } from '../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { IntervalTimer, disposableTimeout } from '../../../base/common/async.js';
import { AgentHostClientConnectionKind } from '../common/agentHostTelemetry.js';
import { AhpJsonlLogger, getAhpLogByteLength } from '../common/ahpJsonlLogger.js';
import type { AhpServerNotification, JsonRpcNotification, JsonRpcRequest, JsonRpcResponse, ProtocolMessage } from '../common/state/sessionProtocol.js';
import type { IClientTransport } from '../common/state/sessionTransport.js';
import { Reassembler } from '../common/webPubSub/chunking.js';
import { type InboundResult, RELIABLE_JSON_SUBPROTOCOL, buildPublish, parseInbound } from '../common/webPubSub/framing.js';
import type { ParseGroupNameOptions } from '../common/webPubSub/groups.js';

const REASSEMBLY_SWEEP_INTERVAL_MS = 15_000;

const WPS_HANDSHAKE_TIMEOUT_MS = 30_000;

export interface IWebSocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: { code: number; reason: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string, subprotocol: string) => IWebSocketLike;

const defaultWebSocketFactory: WebSocketFactory = (url, subprotocol) =>
	new WebSocket(url, subprotocol) as unknown as IWebSocketLike;

const inboundDecoder = new TextDecoder('utf-8');

function frameDataToString(data: unknown): string {
	if (typeof data === 'string') {
		return data;
	}
	if (data instanceof ArrayBuffer) {
		return inboundDecoder.decode(data);
	}
	if (ArrayBuffer.isView(data)) {
		return inboundDecoder.decode(data);
	}
	return String(data);
}

export interface IWebPubSubRelayTransportOptions {
	readonly url: string;
	readonly toHostGroup: string;
	readonly joinGroups: readonly string[];
	readonly groupValidation?: ParseGroupNameOptions;
	readonly webSocketFactory?: WebSocketFactory;
	readonly onProtocolError?: (err: unknown) => void;
	readonly ahpLogger?: AhpJsonlLogger;
}

export class WebPubSubRelayTransport extends Disposable implements IClientTransport {
	readonly clientConnectionKind = AgentHostClientConnectionKind.WebPubSub;

	private readonly _onMessage = this._register(new Emitter<ProtocolMessage>());
	readonly onMessage = this._onMessage.event;

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private readonly _reassembler = new Reassembler();
	private readonly _sweepTimer = this._register(new IntervalTimer());

	private _ws: IWebSocketLike | undefined;
	private _ackId = 0;
	private readonly _pendingJoinAcks = new Map<number, string>();

	private _closed = false;
	private _connectResolved = false;

	constructor(private readonly _options: IWebPubSubRelayTransportOptions) {
		super();
		if (this._options.ahpLogger) {
			this._register(this._options.ahpLogger);
		}
	}

	get isOpen(): boolean {
		return this._ws !== undefined && !this._closed && this._connectResolved;
	}

	connect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this._store.isDisposed) {
				reject(new Error('Transport is disposed'));
				return;
			}

			const factory = this._options.webSocketFactory ?? defaultWebSocketFactory;
			const ws = factory(this._options.url, RELIABLE_JSON_SUBPROTOCOL);
			this._ws = ws;

			const handshakeStore = new DisposableStore();

			const settleReject = (err: Error) => {
				handshakeStore.dispose();
				this._failConnect();
				reject(err);
			};

			const settleResolve = () => {
				handshakeStore.dispose();
				this._connectResolved = true;
				this._startObserving();
				resolve();
			};

			handshakeStore.add(disposableTimeout(() => {
				settleReject(new Error('WPS handshake timed out'));
			}, WPS_HANDSHAKE_TIMEOUT_MS));

			ws.onopen = () => {
			};

			ws.onmessage = event => {
				let frame: Record<string, unknown>;
				try {
					frame = JSON.parse(frameDataToString(event.data)) as Record<string, unknown>;
				} catch (err) {
					this._options.onProtocolError?.(err);
					return;
				}
				this._handleHandshakeFrame(frame, settleResolve, settleReject);
			};

			ws.onerror = () => {
				settleReject(new Error('WebSocket error during WPS connect'));
			};

			ws.onclose = ev => {
				settleReject(new Error(`WebSocket closed before connection was established: ${ev.code} ${ev.reason}`));
			};
		});
	}

	private _handleHandshakeFrame(frame: Record<string, unknown>, onConnected: () => void, onFail: (err: Error) => void): void {
		if (frame['type'] === 'system' && frame['event'] === 'connected') {
			for (const group of this._options.joinGroups) {
				const ackId = ++this._ackId;
				this._pendingJoinAcks.set(ackId, group);
				this._sendRaw({ type: 'joinGroup', group, ackId });
			}
			if (this._pendingJoinAcks.size === 0) {
				onConnected();
			}
			return;
		}

		if (frame['type'] === 'ack') {
			const ackId = typeof frame['ackId'] === 'number' ? frame['ackId'] : undefined;
			if (ackId === undefined || !this._pendingJoinAcks.has(ackId)) {
				return;
			}
			const group = this._pendingJoinAcks.get(ackId);
			this._pendingJoinAcks.delete(ackId);
			if (frame['success'] === false) {
				onFail(new Error(`WPS joinGroup failed for group '${group}'`));
				return;
			}
			if (this._pendingJoinAcks.size === 0) {
				onConnected();
			}
			return;
		}

		this._ingestGroupFrame(frame);
	}

	private _startObserving(): void {
		const ws = this._ws;
		if (!ws) {
			return;
		}
		this._sweepTimer.cancelAndSet(() => this._reassembler.sweepExpired(), REASSEMBLY_SWEEP_INTERVAL_MS);

		ws.onmessage = event => {
			let frame: Record<string, unknown>;
			try {
				frame = JSON.parse(frameDataToString(event.data)) as Record<string, unknown>;
			} catch (err) {
				this._options.onProtocolError?.(err);
				return;
			}
			this._ingestGroupFrame(frame);
		};
		ws.onclose = () => this._fireClose();
		ws.onerror = () => this._fireClose();
	}

	private _ingestGroupFrame(frame: Record<string, unknown>): void {
		let result: InboundResult;
		try {
			result = parseInbound(frame, { reassembler: this._reassembler, groupValidation: this._options.groupValidation });
		} catch (err) {
			this._options.onProtocolError?.(err);
			return;
		}
		if (result.kind === 'payload') {
			const payload = result.payload as ProtocolMessage;
			this._options.ahpLogger?.log(payload, 's2c', getAhpLogByteLength(JSON.stringify(payload)));
			this._onMessage.fire(payload);
		}
	}

	send(message: ProtocolMessage | AhpServerNotification | JsonRpcNotification | JsonRpcResponse | JsonRpcRequest): void {
		if (this._closed || !this._ws) {
			throw new Error('WebPubSubRelayTransport is closed');
		}
		this._options.ahpLogger?.log(message, 'c2s', getAhpLogByteLength(JSON.stringify(message)));
		const frames = buildPublish({
			group: this._options.toHostGroup,
			nextAckId: () => ++this._ackId,
			payload: message,
		});
		for (const frame of frames) {
			this._sendRaw(frame);
		}
	}

	private _sendRaw(obj: unknown): void {
		this._ws?.send(JSON.stringify(obj));
	}

	private _fireClose(): void {
		if (this._closed) {
			return;
		}
		this._closed = true;
		this._sweepTimer.cancel();
		this._onClose.fire();
	}

	private _failConnect(): void {
		this._closed = true;
		this._sweepTimer.cancel();
		try {
			this._ws?.close();
		} catch {
		}
	}

	override dispose(): void {
		if (!this._closed) {
			this._closed = true;
			this._sweepTimer.cancel();
			try {
				this._ws?.close();
			} catch {
			}
		}
		super.dispose();
	}
}
