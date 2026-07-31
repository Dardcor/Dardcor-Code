/**
 * Dardcor Code - Zero-copy RPC Protocol Channel Serializer (Task 602)
 * Mirrors: vs/workbench/api/common/rpcProtocol.ts
 */

import { Disposable, IDisposable, toDisposable } from "../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../core/events/emitter.js";

export enum RPCType {
	Request = 1,
	Response = 2,
	Notification = 3
}

export interface IRPCMessage {
	seq: number;
	type: RPCType;
	id?: number;
	channel?: string;
	command?: string;
	payload?: any;
	error?: string;
}

export interface IRPCChannelHandler {
	call(command: string, payload: any): any | Promise<any>;
	notify?(command: string, payload: any): void;
}

export interface IRPCTransport {
	send(data: Uint8Array): void;
	readonly onData: Event<Uint8Array>;
	readonly onClose: Event<void>;
	readonly onError: Event<Error>;
}

export interface IProcessLike {
	send(message: any): boolean;
	on(event: 'message', listener: (message: any) => void): void;
	on(event: 'disconnect' | 'close', listener: () => void): void;
}

const HEADER_SIZE = 4;

function frameMessage(msg: IRPCMessage): Uint8Array {
	const body = Buffer.from(JSON.stringify(msg), 'utf8');
	const frame = Buffer.allocUnsafe(HEADER_SIZE + body.length);
	frame.writeUInt32BE(body.length, 0);
	body.copy(frame, HEADER_SIZE);
	return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
}

export function createChildProcessTransport(proc: IProcessLike): IRPCTransport {
	const onData = new Emitter<Uint8Array>();
	const onClose = new Emitter<void>();
	const onError = new Emitter<Error>();

	proc.on('message', (message: any) => {
		if (message instanceof Uint8Array || Buffer.isBuffer(message)) {
			onData.fire(new Uint8Array(message));
		}
	});
	proc.on('disconnect', () => onClose.fire());
	proc.on('close', () => onClose.fire());

	return {
		send(data: Uint8Array) {
			try {
				proc.send(data);
			} catch (err) {
				onError.fire(err instanceof Error ? err : new Error(String(err)));
			}
		},
		onData: onData.event,
		onClose: onClose.event,
		onError: onError.event
	};
}

export function createParentProcessTransport(child: IProcessLike): IRPCTransport {
	return createChildProcessTransport(child);
}

interface IPendingRequest {
	channel: string;
	command: string;
	resolve: (value: any) => void;
	reject: (err: Error) => void;
}

/**
 * Symmetric request/response + event broadcast RPC. Each endpoint may
 * register channel handlers; `call`/`notify` target the peer endpoint,
 * `emit`/`onEvent` deliver fire-and-forget event broadcasts.
 */
export class RPCProtocol extends Disposable {
	private _seq = 0;
	private _nextSubId = 1;
	private readonly _pending = new Map<number, IPendingRequest>();
	private readonly _channels = new Map<string, IRPCChannelHandler>();
	private readonly _eventListeners = new Map<string, Map<string, Emitter<any>>>();
	private _fragments: Buffer[] = [];
	private _fragmentLength = 0;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(private readonly _transport: IRPCTransport) {
		super();
		this._register(this._transport.onData(data => this._handleChunk(data)));
		this._register(this._transport.onClose(() => {
			this._rejectAll(new Error('RPC connection closed'));
			this._onDidClose.fire();
		}));
		this._register(this._transport.onError(err => this._rejectAll(err)));
	}

	public call<T = any>(channel: string, command: string, payload?: any): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const seq = this._seq++;
			this._pending.set(seq, { channel, command, resolve, reject });
			this._send({ seq, type: RPCType.Request, channel, command, payload });
		});
	}

	public notify(channel: string, command: string, payload?: any): void {
		this._send({ seq: this._seq++, type: RPCType.Notification, channel, command, payload });
	}

	public emit(channel: string, event: string, payload?: any): void {
		this._send({
			seq: this._seq++,
			type: RPCType.Notification,
			channel: '$event',
			command: '$event',
			payload: { channel, event, payload }
		});
	}

	public onEvent<T = any>(channel: string, event: string): Event<T> {
		let byEvent = this._eventListeners.get(channel);
		if (!byEvent) {
			byEvent = new Map();
			this._eventListeners.set(channel, byEvent);
		}
		let emitter = byEvent.get(event);
		if (!emitter) {
			emitter = new Emitter<T>();
			byEvent.set(event, emitter);
		}
		return emitter.event;
	}

	public registerChannel(name: string, handler: IRPCChannelHandler): IDisposable {
		if (this._channels.has(name)) {
			throw new Error(`Channel '${name}' sudah terdaftar`);
		}
		this._channels.set(name, handler);
		return toDisposable(() => this._channels.delete(name));
	}

	public unregisterChannel(name: string): void {
		this._channels.delete(name);
	}

	public hasChannel(name: string): boolean {
		return this._channels.has(name);
	}

	public override dispose(): void {
		this._rejectAll(new Error('RPC protocol dibuang'));
		this._channels.clear();
		this._eventListeners.clear();
		super.dispose();
	}

	private _send(msg: IRPCMessage): void {
		this._transport.send(frameMessage(msg));
	}

	private _handleChunk(chunk: Uint8Array): void {
		this._fragments.push(Buffer.from(chunk));
		this._fragmentLength += chunk.byteLength;

		while (this._fragmentLength >= HEADER_SIZE) {
			const merged = this._fragmentLength === this._fragments[0]!.length && this._fragments.length === 1
				? this._fragments[0]!
				: Buffer.concat(this._fragments, this._fragmentLength);
			const bodyLength = merged.readUInt32BE(0);
			if (merged.length < HEADER_SIZE + bodyLength) {
				this._fragments = [merged];
				this._fragmentLength = merged.length;
				return;
			}
			const body = merged.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
			this._handleMessage(JSON.parse(body.toString('utf8')));
			const rest = merged.subarray(HEADER_SIZE + bodyLength);
			if (rest.length === 0) {
				this._fragments = [];
				this._fragmentLength = 0;
				return;
			}
			this._fragments = [rest];
			this._fragmentLength = rest.length;
		}
	}

	private _handleMessage(msg: IRPCMessage): void {
		switch (msg.type) {
			case RPCType.Request:
				this._handleRequest(msg);
				break;
			case RPCType.Response:
				this._handleResponse(msg);
				break;
			case RPCType.Notification:
				this._handleNotification(msg);
				break;
		}
	}

	private _handleRequest(msg: IRPCMessage): void {
		const handler = this._channels.get(msg.channel ?? '');
		if (!handler) {
			this._send({ seq: this._seq++, type: RPCType.Response, id: msg.id, error: `Channel '${msg.channel}' tidak dikenal` });
			return;
		}
		try {
			const result = handler.call(msg.command ?? '', msg.payload);
			if (result && typeof result.then === 'function') {
				result.then(
					(value: any) => this._send({ seq: this._seq++, type: RPCType.Response, id: msg.id, payload: value }),
					(err: any) => this._send({ seq: this._seq++, type: RPCType.Response, id: msg.id, error: String(err?.message ?? err) })
				);
			} else {
				this._send({ seq: this._seq++, type: RPCType.Response, id: msg.id, payload: result });
			}
		} catch (err) {
			this._send({ seq: this._seq++, type: RPCType.Response, id: msg.id, error: String(err instanceof Error ? err.message : err) });
		}
	}

	private _handleResponse(msg: IRPCMessage): void {
		const pending = this._pending.get(msg.id ?? -1);
		if (!pending) {
			return;
		}
		this._pending.delete(msg.id!);
		if (msg.error) {
			pending.reject(new Error(msg.error));
		} else {
			pending.resolve(msg.payload);
		}
	}

	private _handleNotification(msg: IRPCMessage): void {
		if (msg.channel === '$event' && msg.command === '$event') {
			const evt = msg.payload as { channel: string; event: string; payload: any };
			const emitter = this._eventListeners.get(evt.channel)?.get(evt.event);
			emitter?.fire(evt.payload);
			return;
		}
		const handler = this._channels.get(msg.channel ?? '');
		handler?.notify?.(msg.command ?? '', msg.payload);
	}

	private _rejectAll(err: Error): void {
		for (const [, pending] of this._pending) {
			pending.reject(err);
		}
		this._pending.clear();
	}
}
