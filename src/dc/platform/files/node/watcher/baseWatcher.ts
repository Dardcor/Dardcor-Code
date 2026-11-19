/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { watchFile, unwatchFile, Stats } from 'fs';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { ILogMessage, IRecursiveWatcherWithSubscribe, IUniversalWatchRequest, IWatchRequestWithCorrelation, IWatcher, IWatcherErrorEvent, isWatchRequestWithCorrelation, requestFilterToString } from '../../common/watcher.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { FileChangeType, IFileChange } from '../../common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { DeferredPromise, ThrottledDelayer } from '../../../../base/common/async.js';
import { hash } from '../../../../base/common/hash.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';

interface ISuspendedWatchRequest {
	readonly id: number;
	readonly correlationId: number | undefined;
	readonly path: string;
}

export abstract class BaseWatcher extends Disposable implements IWatcher {

	protected readonly _onDidChangeFile = this._register(new Emitter<IFileChange[]>());
	readonly onDidChangeFile = this._onDidChangeFile.event;

	protected readonly _onDidLogMessage = this._register(new Emitter<ILogMessage>());
	readonly onDidLogMessage = this._onDidLogMessage.event;

	protected readonly _onDidWatchFail = this._register(new Emitter<IUniversalWatchRequest>());
	private readonly onDidWatchFail = this._onDidWatchFail.event;

	private readonly correlatedWatchRequests = new Map<number , IWatchRequestWithCorrelation>();
	private readonly nonCorrelatedWatchRequests = new Map<number , IUniversalWatchRequest>();

	private readonly suspendedWatchRequests = this._register(new DisposableMap<number >());
	private readonly suspendedWatchRequestsWithPolling = new Set<number >();

	private readonly updateWatchersDelayer = this._register(new ThrottledDelayer<void>(this.getUpdateWatchersDelay()));

	protected readonly suspendedWatchRequestPollingInterval: number = 5007;

	private joinWatch = new DeferredPromise<void>();

	constructor() {
		super();

		this._register(this.onDidWatchFail(request => this.suspendWatchRequest({
			id: this.computeId(request),
			correlationId: this.isCorrelated(request) ? request.correlationId : undefined,
			path: request.path
		})));
	}

	protected isCorrelated(request: IUniversalWatchRequest): request is IWatchRequestWithCorrelation {
		return isWatchRequestWithCorrelation(request);
	}

	private computeId(request: IUniversalWatchRequest): number {
		if (this.isCorrelated(request)) {
			return request.correlationId;
		} else {
			return hash(request);
		}
	}

	async watch(requests: IUniversalWatchRequest[]): Promise<void> {
		if (!this.joinWatch.isSettled) {
			this.joinWatch.complete();
		}
		this.joinWatch = new DeferredPromise<void>();

		try {
			this.correlatedWatchRequests.clear();
			this.nonCorrelatedWatchRequests.clear();

			for (const request of requests) {
				if (this.isCorrelated(request)) {
					this.correlatedWatchRequests.set(request.correlationId, request);
				} else {
					this.nonCorrelatedWatchRequests.set(this.computeId(request), request);
				}
			}

			for (const [id] of this.suspendedWatchRequests) {
				if (!this.nonCorrelatedWatchRequests.has(id) && !this.correlatedWatchRequests.has(id)) {
					this.suspendedWatchRequests.deleteAndDispose(id);
					this.suspendedWatchRequestsWithPolling.delete(id);
				}
			}

			return await this.updateWatchers(false );
		} finally {
			this.joinWatch.complete();
		}
	}

	private updateWatchers(delayed: boolean): Promise<void> {
		const nonSuspendedRequests: IUniversalWatchRequest[] = [];
		for (const [id, request] of [...this.nonCorrelatedWatchRequests, ...this.correlatedWatchRequests]) {
			if (!this.suspendedWatchRequests.has(id)) {
				nonSuspendedRequests.push(request);
			}
		}

		return this.updateWatchersDelayer.trigger(() => this.doWatch(nonSuspendedRequests), delayed ? this.getUpdateWatchersDelay() : 0).catch(error => onUnexpectedError(error));
	}

	protected getUpdateWatchersDelay(): number {
		return 800;
	}

	isSuspended(request: IUniversalWatchRequest): 'polling' | boolean {
		const id = this.computeId(request);
		return this.suspendedWatchRequestsWithPolling.has(id) ? 'polling' : this.suspendedWatchRequests.has(id);
	}

	private async suspendWatchRequest(request: ISuspendedWatchRequest): Promise<void> {
		if (this.suspendedWatchRequests.has(request.id)) {
			return;
		}

		const disposables = new DisposableStore();
		this.suspendedWatchRequests.set(request.id, disposables);


		await this.joinWatch.p;

		if (disposables.isDisposed) {
			return;
		}

		this.monitorSuspendedWatchRequest(request, disposables);

		this.updateWatchers(true );
	}

	private resumeWatchRequest(request: ISuspendedWatchRequest): void {
		this.suspendedWatchRequests.deleteAndDispose(request.id);
		this.suspendedWatchRequestsWithPolling.delete(request.id);

		this.updateWatchers(false);
	}

	private monitorSuspendedWatchRequest(request: ISuspendedWatchRequest, disposables: DisposableStore): void {
		if (this.doMonitorWithExistingWatcher(request, disposables)) {
			this.trace(`reusing an existing recursive watcher to monitor ${request.path}`);
			this.suspendedWatchRequestsWithPolling.delete(request.id);
		} else {
			this.doMonitorWithNodeJS(request, disposables);
			this.suspendedWatchRequestsWithPolling.add(request.id);
		}
	}

	private doMonitorWithExistingWatcher(request: ISuspendedWatchRequest, disposables: DisposableStore): boolean {
		const subscription = this.recursiveWatcher?.subscribe(request.path, (error, change) => {
			if (disposables.isDisposed) {
				return;
			}

			if (error) {
				this.monitorSuspendedWatchRequest(request, disposables);
			} else if (change?.type === FileChangeType.ADDED) {
				this.onMonitoredPathAdded(request);
			}
		});

		if (subscription) {
			disposables.add(subscription);

			return true;
		}

		return false;
	}

	private doMonitorWithNodeJS(request: ISuspendedWatchRequest, disposables: DisposableStore): void {
		let pathNotFound = false;

		const watchFileCallback: (curr: Stats, prev: Stats) => void = (curr, prev) => {
			if (disposables.isDisposed) {
				return;
			}

			const currentPathNotFound = this.isPathNotFound(curr);
			const previousPathNotFound = this.isPathNotFound(prev);
			const oldPathNotFound = pathNotFound;
			pathNotFound = currentPathNotFound;

			if (!currentPathNotFound && (previousPathNotFound || oldPathNotFound)) {
				this.onMonitoredPathAdded(request);
			}
		};

		this.trace(`starting fs.watchFile() on ${request.path} (correlationId: ${request.correlationId})`);
		try {
			watchFile(request.path, { persistent: false, interval: this.suspendedWatchRequestPollingInterval }, watchFileCallback);
		} catch (error) {
			this.warn(`fs.watchFile() failed with error ${error} on path ${request.path} (correlationId: ${request.correlationId})`);
		}

		disposables.add(toDisposable(() => {
			this.trace(`stopping fs.watchFile() on ${request.path} (correlationId: ${request.correlationId})`);

			try {
				unwatchFile(request.path, watchFileCallback);
			} catch (error) {
				this.warn(`fs.unwatchFile() failed with error ${error} on path ${request.path} (correlationId: ${request.correlationId})`);
			}
		}));
	}

	private onMonitoredPathAdded(request: ISuspendedWatchRequest): void {
		this.trace(`detected ${request.path} exists again, resuming watcher (correlationId: ${request.correlationId})`);

		const event: IFileChange = { resource: URI.file(request.path), type: FileChangeType.ADDED, cId: request.correlationId };
		this._onDidChangeFile.fire([event]);
		this.traceEvent(event, request);

		this.resumeWatchRequest(request);
	}

	private isPathNotFound(stats: Stats): boolean {
		return stats.ctimeMs === 0 && stats.ino === 0;
	}

	async stop(): Promise<void> {
		this.suspendedWatchRequests.clearAndDisposeAll();
		this.suspendedWatchRequestsWithPolling.clear();
	}

	protected traceEvent(event: IFileChange, request: IUniversalWatchRequest | ISuspendedWatchRequest): void {
		if (this.verboseLogging) {
			const traceMsg = ` >> normalized ${event.type === FileChangeType.ADDED ? '[ADDED]' : event.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${event.resource.fsPath}`;
			this.traceWithCorrelation(traceMsg, request);
		}
	}

	protected traceWithCorrelation(message: string, request: IUniversalWatchRequest | ISuspendedWatchRequest): void {
		if (this.verboseLogging) {
			this.trace(`${message}${typeof request.correlationId === 'number' ? ` <${request.correlationId}> ` : ``}`);
		}
	}

	protected requestToString(request: IUniversalWatchRequest): string {
		return `${request.path} (excludes: ${request.excludes.length > 0 ? request.excludes : '<none>'}, includes: ${request.includes && request.includes.length > 0 ? JSON.stringify(request.includes) : '<all>'}, filter: ${requestFilterToString(request.filter)}, correlationId: ${typeof request.correlationId === 'number' ? request.correlationId : '<none>'})`;
	}

	protected abstract doWatch(requests: IUniversalWatchRequest[]): Promise<void>;

	protected abstract readonly recursiveWatcher: IRecursiveWatcherWithSubscribe | undefined;

	protected abstract trace(message: string): void;
	protected abstract warn(message: string): void;

	abstract onDidError: Event<IWatcherErrorEvent>;

	protected verboseLogging = false;

	async setVerboseLogging(enabled: boolean): Promise<void> {
		this.verboseLogging = enabled;
	}
}
