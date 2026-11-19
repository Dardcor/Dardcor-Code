/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { GLOBSTAR, IRelativePattern, parse, ParsedPattern } from '../../../base/common/glob.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../base/common/lifecycle.js';
import { isAbsolute } from '../../../base/common/path.js';
import { isLinux } from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';
import { FileChangeFilter, FileChangeType, IFileChange, isParent } from './files.js';

interface IWatchRequest {

	readonly path: string;

	readonly recursive: boolean;

	readonly excludes: string[];

	readonly includes?: Array<string | IRelativePattern>;

	readonly correlationId?: number;

	readonly filter?: FileChangeFilter;
}

export interface IWatchRequestWithCorrelation extends IWatchRequest {
	readonly correlationId: number;
}

export function isWatchRequestWithCorrelation(request: IWatchRequest): request is IWatchRequestWithCorrelation {
	return typeof request.correlationId === 'number';
}

export interface INonRecursiveWatchRequest extends IWatchRequest {

	readonly recursive: false;
}

export interface IRecursiveWatchRequest extends IWatchRequest {

	readonly recursive: true;

	pollingInterval?: number;
}

export function isRecursiveWatchRequest(request: IWatchRequest): request is IRecursiveWatchRequest {
	return request.recursive === true;
}

export type IUniversalWatchRequest = IRecursiveWatchRequest | INonRecursiveWatchRequest;

export interface IWatcherErrorEvent {
	readonly error: string;
	readonly request?: IUniversalWatchRequest;
}

export interface IWatcher {

	readonly onDidChangeFile: Event<IFileChange[]>;

	readonly onDidLogMessage: Event<ILogMessage>;

	readonly onDidError: Event<IWatcherErrorEvent>;

	watch(requests: IWatchRequest[]): Promise<void>;

	setVerboseLogging(enabled: boolean): Promise<void>;

	stop(): Promise<void>;
}

export interface IRecursiveWatcher extends IWatcher {
	watch(requests: IRecursiveWatchRequest[]): Promise<void>;
}

export interface IRecursiveWatcherWithSubscribe extends IRecursiveWatcher {

	subscribe(path: string, callback: (error: true | null, change?: IFileChange) => void): IDisposable | undefined;
}

export interface IRecursiveWatcherOptions {

	readonly usePolling: boolean | string[];

	readonly pollingInterval?: number;
}

export interface INonRecursiveWatcher extends IWatcher {
	watch(requests: INonRecursiveWatchRequest[]): Promise<void>;
}

export interface IUniversalWatcher extends IWatcher {
	watch(requests: IUniversalWatchRequest[]): Promise<void>;
}

export abstract class AbstractWatcherClient extends Disposable {

	private static readonly MAX_RESTARTS = 5;

	private watcher: IWatcher | undefined;
	private readonly watcherDisposables = this._register(new MutableDisposable());

	private requests: IWatchRequest[] | undefined = undefined;

	private restartCounter = 0;

	constructor(
		private readonly onFileChanges: (changes: IFileChange[]) => void,
		private readonly onLogMessage: (msg: ILogMessage) => void,
		private verboseLogging: boolean,
		private options: {
			readonly type: string;
			readonly restartOnError: boolean;
		}
	) {
		super();
	}

	protected abstract createWatcher(disposables: DisposableStore): IWatcher;

	protected init(): void {

		const disposables = new DisposableStore();
		this.watcherDisposables.value = disposables;

		this.watcher = this.createWatcher(disposables);
		this.watcher.setVerboseLogging(this.verboseLogging);

		disposables.add(this.watcher.onDidChangeFile(changes => this.onFileChanges(changes)));
		disposables.add(this.watcher.onDidLogMessage(msg => this.onLogMessage(msg)));
		disposables.add(this.watcher.onDidError(e => this.onError(e.error, e.request)));
	}

	protected onError(error: string, failedRequest?: IUniversalWatchRequest): void {

		if (this.canRestart(error, failedRequest)) {
			if (this.restartCounter < AbstractWatcherClient.MAX_RESTARTS && this.requests) {
				this.error(`restarting watcher after unexpected error: ${error}`);
				this.restart(this.requests);
			} else {
				this.error(`gave up attempting to restart watcher after unexpected error: ${error}`);
			}
		}

		else {
			this.error(error);
		}
	}

	private canRestart(error: string, failedRequest?: IUniversalWatchRequest): boolean {
		if (!this.options.restartOnError) {
			return false;
		}

		if (failedRequest) {
			return false;
		}

		if (
			error.indexOf('No space left on device') !== -1 ||
			error.indexOf('EMFILE') !== -1
		) {
			return false;
		}

		return true;
	}

	private restart(requests: IUniversalWatchRequest[]): void {
		this.restartCounter++;

		this.init();
		this.watch(requests);
	}

	async watch(requests: IUniversalWatchRequest[]): Promise<void> {
		this.requests = requests;

		await this.watcher?.watch(requests);
	}

	async setVerboseLogging(verboseLogging: boolean): Promise<void> {
		this.verboseLogging = verboseLogging;

		await this.watcher?.setVerboseLogging(verboseLogging);
	}

	private error(message: string) {
		this.onLogMessage({ type: 'error', message: `[File Watcher (${this.options.type})] ${message}` });
	}

	protected trace(message: string) {
		this.onLogMessage({ type: 'trace', message: `[File Watcher (${this.options.type})] ${message}` });
	}

	override dispose(): void {

		this.watcher = undefined;

		return super.dispose();
	}
}

export abstract class AbstractNonRecursiveWatcherClient extends AbstractWatcherClient {

	constructor(
		onFileChanges: (changes: IFileChange[]) => void,
		onLogMessage: (msg: ILogMessage) => void,
		verboseLogging: boolean
	) {
		super(onFileChanges, onLogMessage, verboseLogging, { type: 'node.js', restartOnError: false });
	}

	protected abstract override createWatcher(disposables: DisposableStore): INonRecursiveWatcher;
}

export abstract class AbstractUniversalWatcherClient extends AbstractWatcherClient {

	constructor(
		onFileChanges: (changes: IFileChange[]) => void,
		onLogMessage: (msg: ILogMessage) => void,
		verboseLogging: boolean
	) {
		super(onFileChanges, onLogMessage, verboseLogging, { type: 'universal', restartOnError: true });
	}

	protected abstract override createWatcher(disposables: DisposableStore): IUniversalWatcher;
}

export interface ILogMessage {
	readonly type: 'trace' | 'warn' | 'error' | 'info' | 'debug';
	readonly message: string;
}

export function reviveFileChanges(changes: IFileChange[]): IFileChange[] {
	return changes.map(change => ({
		type: change.type,
		resource: URI.revive(change.resource),
		cId: change.cId
	}));
}

export function coalesceEvents(changes: IFileChange[]): IFileChange[] {

	const coalescer = new EventCoalescer();
	for (const event of changes) {
		coalescer.processEvent(event);
	}

	return coalescer.coalesce();
}

export function normalizeWatcherPattern(path: string, pattern: string | IRelativePattern): string | IRelativePattern {


	if (typeof pattern === 'string' && !pattern.startsWith(GLOBSTAR) && !isAbsolute(pattern)) {
		return { base: path, pattern };
	}

	return pattern;
}

export function parseWatcherPatterns(path: string, patterns: Array<string | IRelativePattern>, ignoreCase: boolean): ParsedPattern[] {
	const parsedPatterns: ParsedPattern[] = [];

	for (const pattern of patterns) {
		parsedPatterns.push(parse(normalizeWatcherPattern(path, pattern), { ignoreCase }));
	}

	return parsedPatterns;
}

class EventCoalescer {

	private readonly coalesced = new Set<IFileChange>();
	private readonly mapPathToChange = new Map<string, IFileChange>();

	private toKey(event: IFileChange): string {
		if (isLinux) {
			return event.resource.fsPath;
		}

		return event.resource.fsPath.toLowerCase();
	}

	processEvent(event: IFileChange): void {
		const existingEvent = this.mapPathToChange.get(this.toKey(event));

		let keepEvent = false;

		if (existingEvent) {
			const currentChangeType = existingEvent.type;
			const newChangeType = event.type;

			if (existingEvent.resource.fsPath !== event.resource.fsPath && (event.type === FileChangeType.DELETED || event.type === FileChangeType.ADDED)) {
				keepEvent = true;
			}

			else if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.DELETED) {
				this.mapPathToChange.delete(this.toKey(event));
				this.coalesced.delete(existingEvent);
			}

			else if (currentChangeType === FileChangeType.DELETED && newChangeType === FileChangeType.ADDED) {
				existingEvent.type = FileChangeType.UPDATED;
			}

			else if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.UPDATED) { }

			else {
				existingEvent.type = newChangeType;
			}
		}

		else {
			keepEvent = true;
		}

		if (keepEvent) {
			this.coalesced.add(event);
			this.mapPathToChange.set(this.toKey(event), event);
		}
	}

	coalesce(): IFileChange[] {
		const addOrChangeEvents: IFileChange[] = [];
		const deletedPaths: string[] = [];

		return Array.from(this.coalesced).filter(e => {
			if (e.type !== FileChangeType.DELETED) {
				addOrChangeEvents.push(e);

				return false;
			}

			return true;
		}).sort((e1, e2) => {
			return e1.resource.fsPath.length - e2.resource.fsPath.length;
		}).filter(e => {
			if (deletedPaths.some(deletedPath => isParent(e.resource.fsPath, deletedPath, !isLinux ))) {
				return false;
			}

			deletedPaths.push(e.resource.fsPath);

			return true;
		}).concat(addOrChangeEvents);
	}
}

export function isFiltered(event: IFileChange, filter: FileChangeFilter | undefined): boolean {
	if (typeof filter === 'number') {
		switch (event.type) {
			case FileChangeType.ADDED:
				return (filter & FileChangeFilter.ADDED) === 0;
			case FileChangeType.DELETED:
				return (filter & FileChangeFilter.DELETED) === 0;
			case FileChangeType.UPDATED:
				return (filter & FileChangeFilter.UPDATED) === 0;
		}
	}

	return false;
}

export function requestFilterToString(filter: FileChangeFilter | undefined): string {
	if (typeof filter === 'number') {
		const filters = [];
		if (filter & FileChangeFilter.ADDED) {
			filters.push('Added');
		}
		if (filter & FileChangeFilter.DELETED) {
			filters.push('Deleted');
		}
		if (filter & FileChangeFilter.UPDATED) {
			filters.push('Updated');
		}

		if (filters.length === 0) {
			return '<all>';
		}

		return `[${filters.join(', ')}]`;
	}

	return '<none>';
}
