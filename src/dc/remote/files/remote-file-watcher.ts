/**
 * Dardcor Code - Remote File Change Notification Event Forwarder (Task 814)
 */

import { watch, FSWatcher, Stats, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { Emitter, Event } from '../../core/events/emitter';
import { Disposable, IDisposable, toDisposable } from '../../core/lifecycle/disposable';
import { FileChangeType } from '../../services/files/file-service';
import { IRemoteChannelClient, IRemoteChannelServer } from '../transport/connection-multiplexer';

export interface IRemoteFileChange {
	readonly path: string;
	readonly type: FileChangeType;
}

export interface IRemoteFileWatcherOptions {
	readonly debounceMs?: number;
	readonly recursive?: boolean;
}

interface WatchedEntry {
	readonly path: string;
	readonly watcher: FSWatcher;
}

export class RemoteFileWatcher extends Disposable {
	private readonly _root: string;
	private readonly _debounceMs: number;
	private readonly _recursive: boolean;

	private readonly _watched = new Map<string, WatchedEntry>();
	private _pending = new Map<string, IRemoteFileChange>();
	private _flushTimer: any = null;

	private readonly _onDidChange = this._register(new Emitter<IRemoteFileChange[]>());
	readonly onDidChange: Event<IRemoteFileChange[]> = this._onDidChange.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError: Event<Error> = this._onError.event;

	constructor(root: string, options: IRemoteFileWatcherOptions = {}) {
		super();
		this._root = resolve(root);
		this._debounceMs = options.debounceMs ?? 100;
		this._recursive = options.recursive ?? true;
	}

	watch(relativePath: string): IDisposable {
		const target = resolve(this._root, relativePath);
		if (this._watched.has(target)) {
			return toDisposable(() => this.unwatch(relativePath));
		}
		if (this._recursive) {
			try {
				const watcher = watch(target, { recursive: true }, (_event, filename) => {
					this._onFsEvent(target, filename);
				});
				watcher.on('error', (error: Error) => this._onError.fire(error));
				this._watched.set(target, { path: target, watcher });
				return toDisposable(() => this.unwatch(relativePath));
			} catch {
				// Fall through to non-recursive mode (Linux < 19.1 does not support recursive watch).
			}
		}
		try {
			const watcher = watch(target, (_event, filename) => {
				this._onFsEvent(target, filename);
			});
			watcher.on('error', (error: Error) => this._onError.fire(error));
			this._watched.set(target, { path: target, watcher });
			return toDisposable(() => this.unwatch(relativePath));
		} catch (error) {
			this._onError.fire(error instanceof Error ? error : new Error(String(error)));
			return Disposable.None;
		}
	}

	unwatch(relativePath: string): void {
		const target = resolve(this._root, relativePath);
		const entry = this._watched.get(target);
		if (entry) {
			entry.watcher.close();
			this._watched.delete(target);
		}
	}

	watchAll(): IDisposable {
		return this.watch('.');
	}

	flushNow(): void {
		if (!this._flushTimer) {
			return;
		}
		clearTimeout(this._flushTimer);
		this._flushTimer = null;
		this._flush();
	}

	private _onFsEvent(target: string, filename: string | Buffer | null): void {
		const name = typeof filename === 'string' ? filename : filename ? filename.toString() : '';
		if (!name) {
			this._queue({ path: '/', type: FileChangeType.Updated });
			return;
		}
		const absPath = join(target, name);
		const relPath = relative(this._root, absPath).split(sep).join('/');
		if (relPath === '..' || relPath.startsWith('../')) {
			return;
		}
		const type = this._detectChangeType(absPath);
		this._queue({ path: `/${relPath}`, type });
	}

	private _detectChangeType(absPath: string): FileChangeType {
		try {
			const stat: Stats | undefined = getStatSafe(absPath);
			if (!stat) {
				return FileChangeType.Deleted;
			}
			return FileChangeType.Updated;
		} catch {
			return FileChangeType.Deleted;
		}
	}

	private _queue(change: IRemoteFileChange): void {
		this._pending.set(change.path, change);
		if (!this._flushTimer) {
			this._flushTimer = setTimeout(() => {
				this._flushTimer = null;
				this._flush();
			}, this._debounceMs);
		}
	}

	private _flush(): void {
		if (this._pending.size === 0) {
			return;
		}
		const changes = [...this._pending.values()];
		this._pending.clear();
		this._onDidChange.fire(changes);
	}

	override dispose(): void {
		if (this._flushTimer) {
			clearTimeout(this._flushTimer);
			this._flushTimer = null;
		}
		for (const entry of this._watched.values()) {
			try {
				entry.watcher.close();
			} catch {
				// ignore
			}
		}
		this._watched.clear();
		super.dispose();
	}
}

function getStatSafe(absPath: string): Stats | undefined {
	try {
		return statSync(absPath);
	} catch {
		return undefined;
	}
}

export class RemoteFileWatcherClient extends Disposable {
	private readonly _onDidChangeFile = this._register(new Emitter<IRemoteFileChange[]>());
	readonly onDidChangeFile: Event<IRemoteFileChange[]> = this._onDidChangeFile.event;

	constructor(private readonly _channel: IRemoteChannelClient) {
		super();
		this._register(this._channel.onEvent(payload => {
			if (payload && payload.kind === 'changes' && Array.isArray(payload.changes)) {
				this._onDidChangeFile.fire(payload.changes as IRemoteFileChange[]);
			}
		}));
	}

	watch(path: string): Promise<void> {
		return this._channel.call({ op: 'watch', path });
	}

	unwatch(path: string): Promise<void> {
		return this._channel.call({ op: 'unwatch', path });
	}
}

export class RemoteFileWatcherServerChannel implements IRemoteChannelServer {
	private _eventSink: ((payload: any) => void) | null = null;

	constructor(private readonly _watcher: RemoteFileWatcher) {
		this._watcher.onDidChange(changes => {
			if (this._eventSink) {
				this._eventSink({ kind: 'changes', changes });
			}
		});
	}

	setEventSink(sink: (payload: any) => void): void {
		this._eventSink = sink;
	}

	async call(payload: any): Promise<any> {
		if (!payload || typeof payload.op !== 'string') {
			throw new Error('Invalid watcher request');
		}
		switch (payload.op) {
			case 'watch':
				this._watcher.watch(payload.path ?? '.');
				return { ok: true };
			case 'unwatch':
				this._watcher.unwatch(payload.path ?? '.');
				return { ok: true };
			default:
				throw new Error(`Unknown watcher op '${payload.op}'`);
		}
	}
}
