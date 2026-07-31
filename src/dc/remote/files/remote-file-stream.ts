/**
 * Dardcor Code - Chunked Stream Transfer For Large Remote Files (Task 824)
 */

import { open, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { IRemoteChannelClient, IRemoteChannelServer } from '../transport/connection-multiplexer';
import { fromBase64, toBase64 } from './remote-file-provider';

export const DEFAULT_CHUNK_SIZE = 64 * 1024;

export interface IRemoteFileStreamProgress {
	readonly transferred: number;
	readonly total?: number;
}

interface ReadSession {
	readonly handle: FileHandle;
	offset: number;
	readonly size: number;
}

interface WriteSession {
	readonly handle: FileHandle;
	readonly targetPath: string;
}

export class RemoteFileStreamClient extends Disposable {
	private readonly _onReadChunk = this._register(new Emitter<IRemoteFileStreamProgress>());
	readonly onReadChunk: Event<IRemoteFileStreamProgress> = this._onReadChunk.event;

	private readonly _onWriteProgress = this._register(new Emitter<IRemoteFileStreamProgress>());
	readonly onWriteProgress: Event<IRemoteFileStreamProgress> = this._onWriteProgress.event;

	constructor(private readonly _channel: IRemoteChannelClient, private readonly _chunkSize = DEFAULT_CHUNK_SIZE) {
		super();
	}

	async readFile(resource: string, onChunk?: (chunk: Uint8Array, offset: number) => void): Promise<{ bytes: number; total: number }> {
		const opened = await this._channel.call({ op: 'openRead', resource });
		const sessionId = opened.sessionId as number;
		const total = opened.size as number;
		let offset = 0;
		let bytes = 0;
		try {
			for (;;) {
				const result = await this._channel.call({
					op: 'readChunk',
					sessionId,
					offset,
					length: this._chunkSize
				});
				if (!result || result.eof) {
					break;
				}
				const chunk = fromBase64(result.data as string);
				bytes += chunk.byteLength;
				offset += chunk.byteLength;
				onChunk?.(chunk, offset - chunk.byteLength);
				this._onReadChunk.fire({ transferred: bytes, total });
			}
			return { bytes, total };
		} finally {
			await this._channel.call({ op: 'closeRead', sessionId });
		}
	}

	async writeFile(resource: string, content: Uint8Array, onProgress?: (progress: IRemoteFileStreamProgress) => void): Promise<void> {
		const opened = await this._channel.call({ op: 'openWrite', resource });
		const sessionId = opened.sessionId as number;
		let transferred = 0;
		try {
			for (let offset = 0; offset < content.byteLength; offset += this._chunkSize) {
				const chunk = content.subarray(offset, Math.min(offset + this._chunkSize, content.byteLength));
				await this._channel.call({
					op: 'writeChunk',
					sessionId,
					data: toBase64(chunk)
				});
				transferred += chunk.byteLength;
				onProgress?.({ transferred });
				this._onWriteProgress.fire({ transferred });
			}
			await this._channel.call({ op: 'closeWrite', sessionId });
		} catch (error) {
			await this._channel.call({ op: 'abortWrite', sessionId }).catch(() => undefined);
			throw error;
		}
	}
}

export class RemoteFileStreamServerChannel implements IRemoteChannelServer {
	private readonly _root: string;
	private readonly _chunkSize: number;

	private readonly _readSessions = new Map<number, ReadSession>();
	private readonly _writeSessions = new Map<number, WriteSession>();
	private _nextSessionId = 1;

	constructor(root: string, chunkSize = DEFAULT_CHUNK_SIZE) {
		this._root = resolve(root);
		this._chunkSize = chunkSize;
	}

	async call(payload: any): Promise<any> {
		if (!payload || typeof payload.op !== 'string') {
			throw new Error('Invalid stream request');
		}
		switch (payload.op) {
			case 'openRead': return this._openRead(payload.resource);
			case 'readChunk': return this._readChunk(payload.sessionId, payload.offset, payload.length);
			case 'closeRead': return this._closeRead(payload.sessionId);
			case 'openWrite': return this._openWrite(payload.resource);
			case 'writeChunk': return this._writeChunk(payload.sessionId, payload.data);
			case 'closeWrite': return this._closeWrite(payload.sessionId);
			case 'abortWrite': return this._abortWrite(payload.sessionId);
			default:
				throw new Error(`Unknown stream op '${payload.op}'`);
		}
	}

	private _resolveSafe(relativePath: string): string {
		const normalized = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
		const target = resolve(this._root, `.${normalized}`);
		const rootWithSep = this._root.endsWith(sep) || this._root.endsWith('/') ? this._root : this._root + sep;
		if (target !== this._root && !target.startsWith(rootWithSep)) {
			throw new Error(`Path escapes workspace root: ${relativePath}`);
		}
		return target;
	}

	private async _openRead(resource: string): Promise<{ sessionId: number; size: number }> {
		const targetPath = this._resolveSafe(resource);
		const handle = await open(targetPath, 'r');
		const stat = await handle.stat();
		const sessionId = this._nextSessionId++;
		this._readSessions.set(sessionId, { handle, offset: 0, size: stat.size });
		return { sessionId, size: stat.size };
	}

	private async _readChunk(sessionId: number, offset: number, length: number): Promise<{ data: string; eof: boolean }> {
		const session = this._readSessions.get(sessionId);
		if (!session) {
			throw new Error(`Unknown read session '${sessionId}'`);
		}
		if (offset >= session.size) {
			return { data: '', eof: true };
		}
		const buffer = Buffer.alloc(Math.min(length ?? this._chunkSize, session.size - offset));
		const { bytesRead } = await session.handle.read(buffer, 0, buffer.length, offset);
		if (bytesRead === 0) {
			return { data: '', eof: true };
		}
		return { data: toBase64(new Uint8Array(buffer.subarray(0, bytesRead))), eof: false };
	}

	private async _closeRead(sessionId: number): Promise<{ ok: boolean }> {
		const session = this._readSessions.get(sessionId);
		if (!session) {
			return { ok: false };
		}
		this._readSessions.delete(sessionId);
		await session.handle.close();
		return { ok: true };
	}

	private async _openWrite(resource: string): Promise<{ sessionId: number }> {
		const targetPath = this._resolveSafe(resource);
		const parent = dirname(targetPath);
		if (!existsSync(parent)) {
			mkdirSync(parent, { recursive: true });
		}
		const handle = await open(targetPath, 'w');
		const sessionId = this._nextSessionId++;
		this._writeSessions.set(sessionId, { handle, targetPath });
		return { sessionId };
	}

	private async _writeChunk(sessionId: number, data: string): Promise<{ ok: boolean }> {
		const session = this._writeSessions.get(sessionId);
		if (!session) {
			throw new Error(`Unknown write session '${sessionId}'`);
		}
		const buffer = Buffer.from(fromBase64(data));
		await session.handle.write(buffer, 0, buffer.length, null);
		return { ok: true };
	}

	private async _closeWrite(sessionId: number): Promise<{ ok: boolean }> {
		const session = this._writeSessions.get(sessionId);
		if (!session) {
			return { ok: false };
		}
		this._writeSessions.delete(sessionId);
		await session.handle.sync();
		await session.handle.close();
		return { ok: true };
	}

	private async _abortWrite(sessionId: number): Promise<{ ok: boolean }> {
		const session = this._writeSessions.get(sessionId);
		if (!session) {
			return { ok: false };
		}
		this._writeSessions.delete(sessionId);
		await session.handle.close();
		await unlink(session.targetPath).catch(() => undefined);
		return { ok: true };
	}

	disposeSessions(): void {
		for (const session of this._readSessions.values()) {
			session.handle.close().catch(() => undefined);
		}
		for (const session of this._writeSessions.values()) {
			session.handle.close().catch(() => undefined);
		}
		this._readSessions.clear();
		this._writeSessions.clear();
	}
}
