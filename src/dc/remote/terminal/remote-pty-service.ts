/**
 * Dardcor Code - Remote Pseudo-Terminal Allocator & PTY Stream Bridge (Task 811)
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { generateUuid } from '../../core/types/uuid';
import { IRemoteChannelClient, IRemoteChannelServer } from '../transport/connection-multiplexer';
import { toBase64, fromBase64 } from '../files/remote-file-provider';
import { RemoteTerminalProcess, IRemoteTerminalProcessOptions } from './remote-terminal-process';
import { PtyPacketDecoder, PtyPacketKind } from './remote-pty-stream';

export interface IRemotePtyCreateOptions extends IRemoteTerminalProcessOptions {
	readonly name?: string;
}

export interface IRemotePtyExitInfo {
	readonly code: number | null;
	readonly signal: string | null;
}

export class RemotePty extends Disposable {
	private readonly _process: RemoteTerminalProcess;
	private readonly _decoder = new PtyPacketDecoder();

	private readonly _onData = this._register(new Emitter<Uint8Array>());
	readonly onData: Event<Uint8Array> = this._onData.event;

	private readonly _onExit = this._register(new Emitter<IRemotePtyExitInfo>());
	readonly onExit: Event<IRemotePtyExitInfo> = this._onExit.event;

	constructor(
		public readonly id: string,
		public readonly name: string,
		process: RemoteTerminalProcess
	) {
		super();
		this._process = this._register(process);
		this._register(this._process.onData(data => {
			this._decoder.push(data);
		}));
		this._register(this._decoder.onPacket(packet => {
			if (packet.kind === PtyPacketKind.Data) {
				this._onData.fire(packet.data);
			}
		}));
		this._register(this._process.onExit(info => this._onExit.fire(info)));
	}

	get pid(): number | undefined {
		return this._process.pid;
	}

	write(data: Uint8Array | string): void {
		this._process.write(data);
	}

	resize(cols: number, rows: number): void {
		this._process.resize(cols, rows);
	}

	kill(signal?: NodeJS.Signals): void {
		this._process.kill(signal);
	}
}

export class RemotePtyService extends Disposable {
	private readonly _ptys = new Map<string, RemotePty>();

	private readonly _onDidCreatePty = this._register(new Emitter<RemotePty>());
	readonly onDidCreatePty: Event<RemotePty> = this._onDidCreatePty.event;

	private readonly _onDidDisposePty = this._register(new Emitter<string>());
	readonly onDidDisposePty: Event<string> = this._onDidDisposePty.event;

	createPty(options: IRemotePtyCreateOptions = {}): RemotePty {
		const id = generateUuid();
		const name = options.name ?? `pty-${id.slice(0, 8)}`;
		const process = new RemoteTerminalProcess(options);
		const pty = this._register(new RemotePty(id, name, process));
		this._ptys.set(id, pty);
		this._register(pty.onExit(() => {
			this.disposePty(id);
		}));
		this._onDidCreatePty.fire(pty);
		return pty;
	}

	disposePty(id: string): void {
		const pty = this._ptys.get(id);
		if (pty) {
			this._ptys.delete(id);
			pty.dispose();
			this._onDidDisposePty.fire(id);
		}
	}

	getPty(id: string): RemotePty | undefined {
		return this._ptys.get(id);
	}

	list(): RemotePty[] {
		return [...this._ptys.values()];
	}

	get size(): number {
		return this._ptys.size;
	}

	override dispose(): void {
		this._ptys.clear();
		super.dispose();
	}
}

export class RemotePtyChannel implements IRemoteChannelServer {
	private _eventSink: ((payload: any) => void) | null = null;

	constructor(private readonly _service: RemotePtyService) {
		this._service.onDidCreatePty(pty => {
			this._wirePty(pty);
		});
		for (const pty of this._service.list()) {
			this._wirePty(pty);
		}
	}

	setEventSink(sink: (payload: any) => void): void {
		this._eventSink = sink;
	}

	private _wirePty(pty: RemotePty): void {
		pty.onData(data => {
			this._eventSink?.({ kind: 'data', id: pty.id, data: toBase64(data) });
		});
		pty.onExit(info => {
			this._eventSink?.({ kind: 'exit', id: pty.id, info });
		});
	}

	async call(payload: any): Promise<any> {
		if (!payload || typeof payload.op !== 'string') {
			throw new Error('Invalid PTY request');
		}
		switch (payload.op) {
			case 'create': {
				const pty = this._service.createPty(payload.options ?? {});
				return { id: pty.id };
			}
			case 'write': {
				const pty = this._service.getPty(payload.id);
				if (!pty) {
					throw new Error(`Unknown PTY '${payload.id}'`);
				}
				pty.write(fromBase64(payload.data));
				return { ok: true };
			}
			case 'resize': {
				const pty = this._service.getPty(payload.id);
				if (!pty) {
					throw new Error(`Unknown PTY '${payload.id}'`);
				}
				pty.resize(payload.cols, payload.rows);
				return { ok: true };
			}
			case 'kill': {
				this._service.disposePty(payload.id);
				return { ok: true };
			}
			case 'list':
				return this._service.list().map(p => ({ id: p.id, name: p.name, pid: p.pid }));
			default:
				throw new Error(`Unknown PTY op '${payload.op}'`);
		}
	}
}

export class RemotePtyClient extends Disposable {
	constructor(private readonly _channel: IRemoteChannelClient) {
		super();
	}

	createPty(options: IRemotePtyCreateOptions = {}): Promise<string> {
		return this._channel.call({ op: 'create', options });
	}

	write(id: string, data: Uint8Array | string): Promise<void> {
		const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
		return this._channel.call({ op: 'write', id, data: toBase64(bytes) });
	}

	resize(id: string, cols: number, rows: number): Promise<void> {
		return this._channel.call({ op: 'resize', id, cols, rows });
	}

	kill(id: string): Promise<void> {
		return this._channel.call({ op: 'kill', id });
	}

	list(): Promise<{ id: string; name: string; pid?: number }[]> {
		return this._channel.call({ op: 'list' });
	}
}
