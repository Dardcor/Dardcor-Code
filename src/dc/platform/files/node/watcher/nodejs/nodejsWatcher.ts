/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { patternsEquals } from '../../../../../base/common/glob.js';
import { BaseWatcher } from '../baseWatcher.js';
import { isLinux } from '../../../../../base/common/platform.js';
import { INonRecursiveWatchRequest, INonRecursiveWatcher, IRecursiveWatcherWithSubscribe } from '../../../common/watcher.js';
import { NodeJSFileWatcherLibrary } from './nodejsWatcherLib.js';
import { ThrottledWorker } from '../../../../../base/common/async.js';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';

export interface INodeJSWatcherInstance {

	readonly instance: NodeJSFileWatcherLibrary;

	readonly request: INonRecursiveWatchRequest;
}

export class NodeJSWatcher extends BaseWatcher implements INonRecursiveWatcher {

	readonly onDidError = Event.None;

	private readonly _watchers = new Map<string | number , INodeJSWatcherInstance>();
	get watchers() { return this._watchers.values(); }

	private readonly worker = this._register(new MutableDisposable<ThrottledWorker<INonRecursiveWatchRequest>>());

	constructor(protected readonly recursiveWatcher: IRecursiveWatcherWithSubscribe | undefined) {
		super();
	}

	protected override async doWatch(requests: INonRecursiveWatchRequest[]): Promise<void> {

		requests = this.removeDuplicateRequests(requests);

		const requestsToStart: INonRecursiveWatchRequest[] = [];
		const watchersToStop = new Set(Array.from(this.watchers));
		for (const request of requests) {
			const watcher = this._watchers.get(this.requestToWatcherKey(request));
			if (watcher && patternsEquals(watcher.request.excludes, request.excludes) && patternsEquals(watcher.request.includes, request.includes)) {
				watchersToStop.delete(watcher);
			} else {
				requestsToStart.push(request);
			}
		}


		if (requestsToStart.length) {
			this.trace(`Request to start watching: ${requestsToStart.map(request => this.requestToString(request)).join(',')}`);
		}

		if (watchersToStop.size) {
			this.trace(`Request to stop watching: ${Array.from(watchersToStop).map(watcher => this.requestToString(watcher.request)).join(',')}`);
		}

		this.worker.clear();

		for (const watcher of watchersToStop) {
			this.stopWatching(watcher);
		}

		this.createWatchWorker().work(requestsToStart);
	}

	private createWatchWorker(): ThrottledWorker<INonRecursiveWatchRequest> {


		this.worker.value = new ThrottledWorker<INonRecursiveWatchRequest>({
			maxWorkChunkSize: 100,
			throttleDelay: 100,
			maxBufferedWork: Number.MAX_VALUE
		}, requests => {
			for (const request of requests) {
				this.startWatching(request);
			}
		});

		return this.worker.value;
	}

	private requestToWatcherKey(request: INonRecursiveWatchRequest): string | number {
		return typeof request.correlationId === 'number' ? request.correlationId : this.pathToWatcherKey(request.path);
	}

	private pathToWatcherKey(path: string): string {
		return isLinux ? path : path.toLowerCase() ;
	}

	private startWatching(request: INonRecursiveWatchRequest): void {

		const instance = new NodeJSFileWatcherLibrary(request, this.recursiveWatcher, changes => this._onDidChangeFile.fire(changes), () => this._onDidWatchFail.fire(request), msg => this._onDidLogMessage.fire(msg), this.verboseLogging);

		const watcher: INodeJSWatcherInstance = { request, instance };
		this._watchers.set(this.requestToWatcherKey(request), watcher);
	}

	override async stop(): Promise<void> {
		await super.stop();

		for (const watcher of this.watchers) {
			this.stopWatching(watcher);
		}
	}

	private stopWatching(watcher: INodeJSWatcherInstance): void {
		this.trace(`stopping file watcher`, watcher);

		this._watchers.delete(this.requestToWatcherKey(watcher.request));

		watcher.instance.dispose();
	}

	private removeDuplicateRequests(requests: INonRecursiveWatchRequest[]): INonRecursiveWatchRequest[] {
		const mapCorrelationtoRequests = new Map<number | undefined , Map<string, INonRecursiveWatchRequest>>();

		for (const request of requests) {

			let requestsForCorrelation = mapCorrelationtoRequests.get(request.correlationId);
			if (!requestsForCorrelation) {
				requestsForCorrelation = new Map<string, INonRecursiveWatchRequest>();
				mapCorrelationtoRequests.set(request.correlationId, requestsForCorrelation);
			}

			const path = this.pathToWatcherKey(request.path);
			if (requestsForCorrelation.has(path)) {
				this.trace(`ignoring a request for watching who's path is already watched: ${this.requestToString(request)}`);
			}

			requestsForCorrelation.set(path, request);
		}

		return Array.from(mapCorrelationtoRequests.values()).flatMap(requests => Array.from(requests.values()));
	}

	override async setVerboseLogging(enabled: boolean): Promise<void> {
		super.setVerboseLogging(enabled);

		for (const watcher of this.watchers) {
			watcher.instance.setVerboseLogging(enabled);
		}
	}

	protected trace(message: string, watcher?: INodeJSWatcherInstance): void {
		if (this.verboseLogging) {
			this._onDidLogMessage.fire({ type: 'trace', message: this.toMessage(message, watcher) });
		}
	}

	protected warn(message: string): void {
		this._onDidLogMessage.fire({ type: 'warn', message: this.toMessage(message) });
	}

	private toMessage(message: string, watcher?: INodeJSWatcherInstance): string {
		return watcher ? `[File Watcher (node.js)] ${message} (${this.requestToString(watcher.request)})` : `[File Watcher (node.js)] ${message}`;
	}
}
