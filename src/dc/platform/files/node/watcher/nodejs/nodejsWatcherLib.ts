/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { watch, promises } from 'fs';
import { RunOnceWorker, ThrottledWorker } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isEqual, isEqualOrParent } from '../../../../../base/common/extpath.js';
import { Disposable, DisposableStore, IDisposable, thenRegisterOrDispose, toDisposable } from '../../../../../base/common/lifecycle.js';
import { normalizeNFC } from '../../../../../base/common/normalization.js';
import { basename, dirname, join } from '../../../../../base/common/path.js';
import { isLinux, isMacintosh } from '../../../../../base/common/platform.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { Promises } from '../../../../../base/node/pfs.js';
import { FileChangeFilter, FileChangeType, IFileChange } from '../../../common/files.js';
import { ILogMessage, coalesceEvents, INonRecursiveWatchRequest, parseWatcherPatterns, IRecursiveWatcherWithSubscribe, isFiltered, isWatchRequestWithCorrelation } from '../../../common/watcher.js';
import { Lazy } from '../../../../../base/common/lazy.js';
import { ParsedPattern } from '../../../../../base/common/glob.js';

export class NodeJSFileWatcherLibrary extends Disposable {

	private static readonly FILE_DELETE_HANDLER_DELAY = 100;

	private static readonly FILE_CHANGES_HANDLER_DELAY = 75;

	private readonly throttledFileChangesEmitter = this._register(new ThrottledWorker<IFileChange>(
		{
			maxWorkChunkSize: 100,
			throttleDelay: 200,
			maxBufferedWork: 10000
		},
		events => this.onDidFilesChange(events)
	));

	private readonly fileChangesAggregator = this._register(new RunOnceWorker<IFileChange>(events => this.handleFileChanges(events), NodeJSFileWatcherLibrary.FILE_CHANGES_HANDLER_DELAY));

	private readonly excludes: ParsedPattern[];
	private readonly includes: ParsedPattern[] | undefined;
	private readonly filter: FileChangeFilter | undefined;

	private readonly cts = new CancellationTokenSource();

	private readonly realPath = new Lazy(async () => {


		let result = this.request.path;

		try {
			result = await Promises.realpath(this.request.path);

			if (this.request.path !== result) {
				this.trace(`correcting a path to watch that seems to be a symbolic link (original: ${this.request.path}, real: ${result})`);
			}
		} catch (error) {
		}

		return result;
	});

	readonly ready: Promise<void>;

	private _isReusingRecursiveWatcher = false;
	get isReusingRecursiveWatcher(): boolean { return this._isReusingRecursiveWatcher; }

	private didFail = false;
	get failed(): boolean { return this.didFail; }

	constructor(
		private readonly request: INonRecursiveWatchRequest,
		private readonly recursiveWatcher: IRecursiveWatcherWithSubscribe | undefined,
		private readonly onDidFilesChange: (changes: IFileChange[]) => void,
		private readonly onDidWatchFail?: () => void,
		private readonly onLogMessage?: (msg: ILogMessage) => void,
		private verboseLogging?: boolean
	) {
		super();

		const ignoreCase = !isLinux;
		this.excludes = parseWatcherPatterns(this.request.path, this.request.excludes, ignoreCase);
		this.includes = this.request.includes ? parseWatcherPatterns(this.request.path, this.request.includes, ignoreCase) : undefined;
		this.filter = isWatchRequestWithCorrelation(this.request) ? this.request.filter : undefined;

		this.ready = this.watch();
	}

	private async watch(): Promise<void> {
		try {
			const stat = await promises.stat(this.request.path);

			if (this.cts.token.isCancellationRequested) {
				return;
			}

			await thenRegisterOrDispose(this.doWatch(stat.isDirectory()), this._store);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.error(error);
			} else {
				this.trace(`ignoring a path for watching who's stat info failed to resolve: ${this.request.path} (error: ${error})`);
			}

			this.notifyWatchFailed();
		}
	}

	private notifyWatchFailed(): void {
		this.didFail = true;

		this.onDidWatchFail?.();
	}

	private async doWatch(isDirectory: boolean): Promise<IDisposable> {
		const disposables = new DisposableStore();

		if (this.doWatchWithExistingWatcher(isDirectory, disposables)) {
			this.trace(`reusing an existing recursive watcher for ${this.request.path}`);
			this._isReusingRecursiveWatcher = true;
		} else {
			this._isReusingRecursiveWatcher = false;
			await this.doWatchWithNodeJS(isDirectory, disposables);
		}

		return disposables;
	}

	private doWatchWithExistingWatcher(isDirectory: boolean, disposables: DisposableStore): boolean {
		if (isDirectory) {
			return false;
		}

		const resource = URI.file(this.request.path);
		const subscription = this.recursiveWatcher?.subscribe(this.request.path, async (error, change) => {
			if (disposables.isDisposed) {
				return;
			}

			if (error) {
				await thenRegisterOrDispose(this.doWatch(isDirectory), disposables);
			} else if (change) {
				if (typeof change.cId === 'number' || typeof this.request.correlationId === 'number') {
					// because the event will appear on the global listener already.
					this.onFileChange({ resource, type: change.type, cId: this.request.correlationId }, true );
				}
			}
		});

		if (subscription) {
			disposables.add(subscription);

			return true;
		}

		return false;
	}

	private async doWatchWithNodeJS(isDirectory: boolean, disposables: DisposableStore): Promise<void> {
		const realPath = await this.realPath.value;

		if (this.cts.token.isCancellationRequested) {
			return;
		}

		if (isMacintosh && isEqualOrParent(realPath, '/Volumes/', true)) {
			this.error(`Refusing to watch ${realPath} for changes using fs.watch() for possibly being a network share where watching is unreliable and unstable.`);

			return;
		}

		const cts = new CancellationTokenSource(this.cts.token);
		disposables.add(toDisposable(() => cts.dispose(true)));

		const watcherDisposables = new DisposableStore();
		disposables.add(watcherDisposables);

		try {
			const requestResource = URI.file(this.request.path);
			const pathBasename = basename(realPath);

			const watcher = watch(realPath);
			watcherDisposables.add(toDisposable(() => {
				watcher.removeAllListeners();
				watcher.close();
			}));

			this.trace(`Started watching: '${realPath}'`);

			const folderChildren = new Set<string>();
			if (isDirectory) {
				try {
					for (const child of await Promises.readdir(realPath)) {
						folderChildren.add(child);
					}
				} catch (error) {
					this.error(error);
				}
			}

			if (cts.token.isCancellationRequested) {
				return;
			}

			const mapPathToStatDisposable = new Map<string, IDisposable>();
			watcherDisposables.add(toDisposable(() => {
				for (const [, disposable] of mapPathToStatDisposable) {
					disposable.dispose();
				}
				mapPathToStatDisposable.clear();
			}));

			watcher.on('error', (code: number, signal: string) => {
				if (cts.token.isCancellationRequested) {
					return;
				}

				this.error(`Failed to watch ${realPath} for changes using fs.watch() (${code}, ${signal})`);

				this.notifyWatchFailed();
			});

			watcher.on('change', (type, raw) => {
				if (cts.token.isCancellationRequested) {
					return;
				}

				if (this.verboseLogging) {
					this.traceWithCorrelation(`[raw] ["${type}"] ${raw}`);
				}

				let changedFileName = '';
				if (raw) {
					changedFileName = raw.toString();
					if (isMacintosh) {
						changedFileName = normalizeNFC(changedFileName);
					}
				}

				if (!changedFileName || (type !== 'change' && type !== 'rename')) {
					return;
				}

				if (isDirectory) {

					if (type === 'rename') {

						mapPathToStatDisposable.get(changedFileName)?.dispose();

						const timeoutHandle = setTimeout(async () => {
							mapPathToStatDisposable.delete(changedFileName);

							if (isEqual(changedFileName, pathBasename, !isLinux) && !await Promises.exists(realPath)) {
								this.onWatchedPathDeleted(requestResource);

								return;
							}

							if (cts.token.isCancellationRequested) {
								return;
							}

							const fileExists = await this.existsChildStrictCase(join(realPath, changedFileName));

							if (cts.token.isCancellationRequested) {
								return;
							}

							let type: FileChangeType;
							if (fileExists) {
								if (folderChildren.has(changedFileName)) {
									type = FileChangeType.UPDATED;
								} else {
									type = FileChangeType.ADDED;
									folderChildren.add(changedFileName);
								}
							} else {
								folderChildren.delete(changedFileName);
								type = FileChangeType.DELETED;
							}

							this.onFileChange({ resource: joinPath(requestResource, changedFileName), type, cId: this.request.correlationId });
						}, NodeJSFileWatcherLibrary.FILE_DELETE_HANDLER_DELAY);

						mapPathToStatDisposable.set(changedFileName, toDisposable(() => clearTimeout(timeoutHandle)));
					}

					else {

						let type: FileChangeType;
						if (folderChildren.has(changedFileName)) {
							type = FileChangeType.UPDATED;
						} else {
							type = FileChangeType.ADDED;
							folderChildren.add(changedFileName);
						}

						this.onFileChange({ resource: joinPath(requestResource, changedFileName), type, cId: this.request.correlationId });
					}
				}

				else {

					if (type === 'rename' || !isEqual(changedFileName, pathBasename, !isLinux)) {


						const timeoutHandle = setTimeout(async () => {
							const fileExists = await Promises.exists(realPath);

							if (cts.token.isCancellationRequested) {
								return;
							}

							if (fileExists) {
								this.onFileChange({ resource: requestResource, type: FileChangeType.UPDATED, cId: this.request.correlationId }, true );

								watcherDisposables.add(await this.doWatch(false));
							}

							else {
								this.onWatchedPathDeleted(requestResource);
							}
						}, NodeJSFileWatcherLibrary.FILE_DELETE_HANDLER_DELAY);

						watcherDisposables.clear();
						watcherDisposables.add(toDisposable(() => clearTimeout(timeoutHandle)));
					}

					else {
						this.onFileChange({ resource: requestResource, type: FileChangeType.UPDATED, cId: this.request.correlationId }, true );
					}
				}
			});
		} catch (error) {
			if (cts.token.isCancellationRequested) {
				return;
			}

			this.error(`Failed to watch ${realPath} for changes using fs.watch() (${error.toString()})`);

			this.notifyWatchFailed();
		}
	}

	private onWatchedPathDeleted(resource: URI): void {
		this.warn('Watcher shutdown because watched path got deleted');

		this.onFileChange({ resource, type: FileChangeType.DELETED, cId: this.request.correlationId }, true );
		this.fileChangesAggregator.flush();

		this.notifyWatchFailed();
	}

	private onFileChange(event: IFileChange, skipIncludeExcludeChecks = false): void {
		if (this.cts.token.isCancellationRequested) {
			return;
		}

		if (this.verboseLogging) {
			this.traceWithCorrelation(`${event.type === FileChangeType.ADDED ? '[ADDED]' : event.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${event.resource.fsPath}`);
		}

		if (!skipIncludeExcludeChecks && this.excludes.some(exclude => exclude(event.resource.fsPath))) {
			if (this.verboseLogging) {
				this.traceWithCorrelation(` >> ignored (excluded) ${event.resource.fsPath}`);
			}
		} else if (!skipIncludeExcludeChecks && this.includes && this.includes.length > 0 && !this.includes.some(include => include(event.resource.fsPath))) {
			if (this.verboseLogging) {
				this.traceWithCorrelation(` >> ignored (not included) ${event.resource.fsPath}`);
			}
		} else {
			this.fileChangesAggregator.work(event);
		}
	}

	private handleFileChanges(fileChanges: IFileChange[]): void {

		const coalescedFileChanges = coalesceEvents(fileChanges);

		const filteredEvents: IFileChange[] = [];
		for (const event of coalescedFileChanges) {
			if (isFiltered(event, this.filter)) {
				if (this.verboseLogging) {
					this.traceWithCorrelation(` >> ignored (filtered) ${event.resource.fsPath}`);
				}

				continue;
			}

			filteredEvents.push(event);
		}

		if (filteredEvents.length === 0) {
			return;
		}

		if (this.verboseLogging) {
			for (const event of filteredEvents) {
				this.traceWithCorrelation(` >> normalized ${event.type === FileChangeType.ADDED ? '[ADDED]' : event.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${event.resource.fsPath}`);
			}
		}

		const worked = this.throttledFileChangesEmitter.work(filteredEvents);

		if (!worked) {
			this.warn(`started ignoring events due to too many file change events at once (incoming: ${filteredEvents.length}, most recent change: ${filteredEvents[0].resource.fsPath}). Use 'files.watcherExclude' setting to exclude folders with lots of changing files (e.g. compilation output).`);
		} else {
			if (this.throttledFileChangesEmitter.pending > 0) {
				this.trace(`started throttling events due to large amount of file change events at once (pending: ${this.throttledFileChangesEmitter.pending}, most recent change: ${filteredEvents[0].resource.fsPath}). Use 'files.watcherExclude' setting to exclude folders with lots of changing files (e.g. compilation output).`);
			}
		}
	}

	private async existsChildStrictCase(path: string): Promise<boolean> {
		if (isLinux) {
			return Promises.exists(path);
		}

		try {
			const pathBasename = basename(path);
			const children = await Promises.readdir(dirname(path));

			return children.some(child => child === pathBasename);
		} catch (error) {
			this.trace(error);

			return false;
		}
	}

	setVerboseLogging(verboseLogging: boolean): void {
		this.verboseLogging = verboseLogging;
	}

	private error(error: string): void {
		if (!this.cts.token.isCancellationRequested) {
			this.onLogMessage?.({ type: 'error', message: `[File Watcher (node.js)] ${error}` });
		}
	}

	private warn(message: string): void {
		if (!this.cts.token.isCancellationRequested) {
			this.onLogMessage?.({ type: 'warn', message: `[File Watcher (node.js)] ${message}` });
		}
	}

	private trace(message: string): void {
		if (!this.cts.token.isCancellationRequested && this.verboseLogging) {
			this.onLogMessage?.({ type: 'trace', message: `[File Watcher (node.js)] ${message}` });
		}
	}

	private traceWithCorrelation(message: string): void {
		if (!this.cts.token.isCancellationRequested && this.verboseLogging) {
			this.trace(`${message}${typeof this.request.correlationId === 'number' ? ` <${this.request.correlationId}> ` : ``}`);
		}
	}

	override dispose(): void {
		this.cts.dispose(true);

		super.dispose();
	}
}

export async function watchFileContents(path: string, onData: (chunk: Uint8Array) => void, onReady: () => void, token: CancellationToken, bufferSize = 512): Promise<void> {
	const handle = await Promises.open(path, 'r');
	const buffer = Buffer.allocUnsafe(bufferSize);

	const cts = new CancellationTokenSource(token);

	let error: Error | undefined = undefined;
	let isReading = false;

	const request: INonRecursiveWatchRequest = { path, excludes: [], recursive: false };
	const watcher = new NodeJSFileWatcherLibrary(request, undefined, changes => {
		(async () => {
			for (const { type } of changes) {
				if (type === FileChangeType.UPDATED) {

					if (isReading) {
						return;
					}

					isReading = true;

					try {
						while (!cts.token.isCancellationRequested) {
							const { bytesRead } = await Promises.read(handle, buffer, 0, bufferSize, null);
							if (!bytesRead || cts.token.isCancellationRequested) {
								break;
							}

							onData(buffer.slice(0, bytesRead));
						}
					} catch (err) {
						error = new Error(err);
						cts.dispose(true);
					} finally {
						isReading = false;
					}
				}
			}
		})();
	});

	await watcher.ready;
	onReady();

	return new Promise<void>((resolve, reject) => {
		cts.token.onCancellationRequested(async () => {
			watcher.dispose();

			try {
				await Promises.close(handle);
			} catch (err) {
				error = new Error(err);
			}

			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
}
