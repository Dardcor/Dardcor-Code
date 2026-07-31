/**
 * Dardcor Code - Recursive FileSystem Change Watcher (Task 108)
 */

import { watch, FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { FileChangeEvent, FileChangeType } from './file-service.js';

export class FileSystemWatcher extends Disposable {
	private readonly _onDidChangeFile = this._register(new Emitter<FileChangeEvent[]>());
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

	private _watcher: FSWatcher | null = null;
	private _pending = new Map<string, FileChangeEvent>();
	private _flushTimer: any = null;
	private _disposed = false;

	constructor(
		private readonly _watchPath: string,
		private readonly _debounceMs: number = 100
	) {
		super();
		this.start();
	}

	public start(): void {
		if (this._watcher || this._disposed) {
			return;
		}
		try {
			this._watcher = watch(this._watchPath, { recursive: true }, (eventType, filename) => {
				this._onFsEvent(eventType, filename);
			});
			this._watcher.on('error', () => {
				// Transient watcher errors (e.g. folder deleted) are ignored;
				// the next start() call re-establishes the watch.
			});
		} catch {
			this._watcher = null;
		}
	}

	public stop(): void {
		if (this._watcher) {
			this._watcher.close();
			this._watcher = null;
		}
		this._flush();
	}

	public override dispose(): void {
		this._disposed = true;
		this.stop();
		super.dispose();
	}

	private _onFsEvent(eventType: 'rename' | 'change', filename: string | Buffer | null): void {
		const name = typeof filename === 'string' ? filename : filename ? filename.toString('utf8') : '';
		const fsPath = this._watchPath.endsWith('/') || this._watchPath.endsWith('\\')
			? this._watchPath + name
			: this._watchPath + (name ? '/' + name : '');
		const resource = URI.file(fsPath);

		if (eventType === 'rename') {
			// Rename can mean added, deleted or moved - probe the disk to decide.
			stat(fsPath).then(
				() => this._queue({ resource, type: FileChangeType.Added }),
				() => this._queue({ resource, type: FileChangeType.Deleted })
			);
		} else {
			this._queue({ resource, type: FileChangeType.Updated });
		}
	}

	private _queue(event: FileChangeEvent): void {
		if (this._disposed) {
			return;
		}
		this._pending.set(event.resource.path, event);
		if (this._flushTimer === null) {
			this._flushTimer = setTimeout(() => this._flush(), this._debounceMs);
		}
	}

	private _flush(): void {
		if (this._flushTimer !== null) {
			clearTimeout(this._flushTimer);
			this._flushTimer = null;
		}
		if (this._pending.size === 0) {
			return;
		}
		const events = [...this._pending.values()];
		this._pending.clear();
		this._onDidChangeFile.fire(events);
	}
}

export function createFileSystemWatcher(watchPath: string, debounceMs?: number): FileSystemWatcher {
	return new FileSystemWatcher(watchPath, debounceMs);
}
