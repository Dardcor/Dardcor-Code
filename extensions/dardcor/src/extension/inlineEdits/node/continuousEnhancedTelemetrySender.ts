/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGitExtensionService } from '../../../platform/git/common/gitExtensionService';
import { getUpstreamRemote } from '../../../platform/git/common/utils';
import { ObservableWorkspace } from '../../../platform/inlineEdits/common/observableWorkspace';
import { ITelemetryService, multiplexProperties } from '../../../platform/telemetry/common/telemetry';
import { LogEntry } from '../../../platform/workspaceRecorder/common/workspaceLog';
import { RunOnceScheduler } from '../../../util/dardcor/base/common/async';
import { Disposable, DisposableStore } from '../../../util/dardcor/base/common/lifecycle';
import { autorun } from '../../../util/dardcor/base/common/observable';
import { generateUuid } from '../../../util/dardcor/base/common/uuid';
import { DebugRecorder } from './debugRecorder';
import { NES_GH_TELEMETRY_EVENT_NAME } from './nextEditProviderTelemetry';

export interface IContinuousRecording {
	readonly entries: LogEntry[] | undefined;

	readonly entriesSize: number;

	readonly windowStart: number;

	readonly windowEnd: number;

	readonly sessionId: string;

	readonly sequenceNumber: number;
}

export class ContinuousEnhancedTelemetrySender extends Disposable {

	public static readonly WINDOW_MS = 5 * 60 * 1000;
	public static readonly OVERLAP_MS = 30 * 1000;
	public static readonly IDLE_MS = 5 * 1000;
	public static readonly HARD_CAP_MS = 30 * 1000;
	public static readonly INTERVAL_MS = 5 * 60 * 1000 - 30 * 1000 - 30 * 1000;

	private static readonly MAX_ENTRIES_CHARS = 200 * 1024;

	private readonly _sessionId = generateUuid();
	private _sequenceNumber = 0;

	constructor(
		private readonly _debugRecorder: DebugRecorder,
		private readonly _workspace: ObservableWorkspace | undefined,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IGitExtensionService private readonly _gitExtensionService: IGitExtensionService,
	) {
		super();

		const store = new DisposableStore();
		this._register(store);
		this._runLoop(store);
	}

	private _runLoop(store: DisposableStore): void {
		const tickScheduler = store.add(new RunOnceScheduler(() => {
			if (store.isDisposed) { return; }
			this._onTick(store, () => {
				if (store.isDisposed) { return; }
				tickScheduler.schedule();
			});
		}, ContinuousEnhancedTelemetrySender.INTERVAL_MS));
		tickScheduler.schedule();
	}

	private _onTick(loopStore: DisposableStore, reschedule: () => void): void {
		if (loopStore.isDisposed) { return; }

		const idleStore = new DisposableStore();
		loopStore.add(idleStore);

		let fired = false;
		const fireAndReset = () => {
			if (fired) { return; }
			fired = true;
			loopStore.delete(idleStore);
			try {
				this._sendNow();
			} finally {
				reschedule();
			}
		};

		const idleScheduler = idleStore.add(new RunOnceScheduler(fireAndReset, ContinuousEnhancedTelemetrySender.IDLE_MS));
		const hardCap = idleStore.add(new RunOnceScheduler(fireAndReset, ContinuousEnhancedTelemetrySender.HARD_CAP_MS));

		if (this._workspace) {
			let isFirstRun = true;
			idleStore.add(autorun(reader => {
				this._workspace!.onDidOpenDocumentChange.read(reader);
				if (isFirstRun) {
					isFirstRun = false;
					return;
				}
				idleScheduler.schedule();
			}));
		}

		idleScheduler.schedule();
		hardCap.schedule();
	}

	private _sendNow(): void {
		const now = this._debugRecorder.getTimestamp();
		const windowStart = now - ContinuousEnhancedTelemetrySender.WINDOW_MS;
		const entries = this._debugRecorder.getLogInRange(windowStart, now);

		if (!entries || !hasAnyEdit(entries)) {
			return;
		}

		const entriesJson = JSON.stringify(entries);
		const entriesSize = entriesJson.length;
		const sequenceNumber = this._sequenceNumber++;

		const recording: IContinuousRecording = {
			entries: entriesSize > ContinuousEnhancedTelemetrySender.MAX_ENTRIES_CHARS ? undefined : entries,
			entriesSize,
			windowStart,
			windowEnd: now,
			sessionId: this._sessionId,
			sequenceNumber,
		};

		const repositoryUrls = this._collectWorkspaceRepositories();

		void multiplexProperties({
			continuous: 'true',
			recording: JSON.stringify(recording),
			repositories: repositoryUrls === undefined ? undefined : JSON.stringify(repositoryUrls),
		}).then(properties => this._telemetryService.sendEnhancedGHTelemetryEvent(NES_GH_TELEMETRY_EVENT_NAME,
			properties,
			{
				continuousWindowDurationMs: ContinuousEnhancedTelemetrySender.WINDOW_MS,
				continuousOverlapMs: ContinuousEnhancedTelemetrySender.OVERLAP_MS,
				continuousEntriesCount: entries.length,
				continuousEntriesSize: entriesSize,
				continuousSequenceNumber: sequenceNumber,
			}
		)).catch(() => { });
	}

	private _collectWorkspaceRepositories(): string[] | undefined {
		const git = this._gitExtensionService.getExtensionApi();
		if (!git) {
			return undefined;
		}

		const remoteUrlSet = new Set<string>();
		for (const repository of git.repositories) {
			const remote = getUpstreamRemote(repository);
			if (remote?.fetchUrl) { remoteUrlSet.add(remote.fetchUrl); }
			if (remote?.pushUrl) { remoteUrlSet.add(remote.pushUrl); }
		}

		return remoteUrlSet.size === 0 ? undefined : [...remoteUrlSet];
	}
}

function hasAnyEdit(entries: LogEntry[]): boolean {
	for (const e of entries) {
		if (e.kind === 'changed') { return true; }
	}
	return false;
}
