/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../../base/common/network.js';
import { autorun, constObservable, derived, derivedOpts, IObservable, IReader, ITransaction, observableValue, observableValueOpts, transaction } from '../../../../../../base/common/observable.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { isDefined } from '../../../../../../base/common/types.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { fromAgentHostUri, toAgentHostContentUri, toAgentHostUri } from '../../../../../../platform/agentHost/common/agentHostUri.js';
import { FileEditKind, ToolCallStatus, type ToolCallState } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { IFileService } from '../../../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../../platform/log/common/log.js';
import { IEditorService } from '../../../../../services/editor/common/editorService.js';
import { IChatProgress, IChatWorkspaceEdit } from '../../../common/chatService/chatService.js';
import { ChatEditKind, ChatEditingSessionState, IChatEditingSession, IEditSessionDiffStats, IEditSessionEntryDiff, IModifiedEntryTelemetryInfo, IModifiedFileEntry, IStreamingEdits, ModifiedFileEntryState } from '../../../common/editing/chatEditingService.js';
import { IChatRequestDisablement, IChatResponseModel } from '../../../common/model/chatModel.js';
import { ChatEditingDeletedFileEntry } from '../../chatEditing/chatEditingDeletedFileEntry.js';
import { ChatEditingModifiedDocumentEntry } from '../../chatEditing/chatEditingModifiedDocumentEntry.js';
import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { IWorkingCopyHistoryService } from '../../../../../services/workingCopy/common/workingCopyHistory.js';
import { IQuickDiffService } from '../../../../scm/common/quickDiff.js';
import { fileEditsToExternalEdits, type IToolCallFileEdit } from './stateToProgressAdapter.js';

/**
 * One checkpoint per request. Accumulates the before/after content URIs of
 * every completed tool call's file edits so the request's edits can be
 * undone/redone on disk during {@link AgentHostSnapshotController.restoreSnapshot}.
 */
interface IAgentHostCheckpoint {
	readonly requestId: string;
	readonly edits: IToolCallFileEdit[];
	/** Tool-call IDs whose edits have already been folded into `edits`. */
	readonly seenToolCallIds: Set<string>;
}

/**
 * A full {@link IChatEditingSession} for agent host sessions.
 * Manages live modified file entries, Monaco diff decorations, inline hunk
 * accept/reject actions, and bottom overlay controls for files edited by the agent.
 */
export class AgentHostSnapshotController extends Disposable implements IChatEditingSession {

	readonly supportsKeepUndo = false;
	readonly isGlobalEditingSession = true;

	readonly state: IObservable<ChatEditingSessionState> = constObservable(ChatEditingSessionState.Idle);

	private readonly _entriesObs = observableValue<IModifiedFileEntry[]>(this, []);
	readonly entries: IObservable<readonly IModifiedFileEntry[]> = this._entriesObs;
	private readonly _entriesByUri = new Map<string, IModifiedFileEntry>();
	private readonly _entryDisposables = this._register(new DisposableStore());
	private readonly _filePreEditSnapshots = new Map<string, { content: string; existed: boolean; capturedAt: number }>();
	private readonly _pendingRegistrations = new Map<string, Promise<void>>();
	private readonly _aggregatedDiffsByUri = new Map<string, { added: number; removed: number }>();

	getAggregatedDiff(resource: URI): { added: number; removed: number } | undefined {
		const targetUri = fromAgentHostUri(resource);
		return this._aggregatedDiffsByUri.get(targetUri.toString());
	}

	// ---- Running-state tracking (drives file-explorer spinner) --------------

	/** Tool-call IDs and their associated target file URIs currently executing on the agent host. */
	private readonly _runningToolCalls = new Map<string, readonly URI[]>();
	private readonly _runningCountObs = observableValueOpts<number>({ equalsFn: (a, b) => a === b }, 0);
	private readonly _runningUrisObs = observableValue<readonly URI[]>(this, []);
	/** True while at least one tool call is in flight; consumed by {@link ChatDecorationsProvider}. */
	readonly isRunning: IObservable<boolean> = derived(this, r => this._runningCountObs.read(r) > 0);
	/** Specific file URIs currently being operated on by running tool calls. */
	readonly runningUris: IObservable<readonly URI[]> = this._runningUrisObs;

	readonly requestDisablement: IObservable<IChatRequestDisablement[]> = derivedOpts(
		{ equalsFn: (a, b) => a.length === b.length && a.every((v, i) => v.requestId === b[i].requestId) },
		reader => {
			const currentIdx = this._currentCheckpointIndex.read(reader);
			const disabled: IChatRequestDisablement[] = [];
			for (let i = currentIdx + 1; i < this._checkpoints.length; i++) {
				disabled.push({ requestId: this._checkpoints[i].requestId });
			}
			return disabled;
		},
	);

	readonly canUndo: IObservable<boolean> = derived(this, r => this._currentCheckpointIndex.read(r) >= 0);
	readonly canRedo: IObservable<boolean> = derived(this, r => this._currentCheckpointIndex.read(r) < this._checkpoints.length - 1);

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private readonly _checkpoints: IAgentHostCheckpoint[] = [];
	private readonly _currentCheckpointIndex = observableValue<number>(this, -1);
	private readonly _undoRedoSequencer = new Sequencer();

	constructor(
		readonly chatSessionResource: URI,
		private readonly _connectionAuthority: string,
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ITextModelService private readonly _textModelService: ITextModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IModelService private readonly _modelService: IModelService,
		@IWorkingCopyHistoryService private readonly _workingCopyHistoryService: IWorkingCopyHistoryService,
		@IQuickDiffService private readonly _quickDiffService: IQuickDiffService,
	) {
		super();
	}

	// ---- Hydration from protocol state --------------------------------------

	/**
	 * Ensures a checkpoint exists for the given request. Called at the start
	 * of every turn (and during history hydration) so {@link requestDisablement}
	 * and {@link restoreSnapshot} can reference every request, even ones that
	 * produce no file edits.
	 *
	 * Splices away stale checkpoints past the current index (undo branch
	 * semantics) when a new request arrives after a checkpoint restore.
	 */
	ensureRequestCheckpoint(requestId: string): void {
		// Idempotent on existing requests.
		if (this._checkpoints.some(cp => cp.requestId === requestId)) {
			return;
		}

		// Splice the forward branch when starting a brand-new request after
		// the user restored a checkpoint.
		const currentIdx = this._currentCheckpointIndex.get();
		if (currentIdx < this._checkpoints.length - 1) {
			this._checkpoints.splice(currentIdx + 1);
		}

		this._checkpoints.push({ requestId, edits: [], seenToolCallIds: new Set() });

		// Advance the cursor to the new checkpoint. Otherwise the just-added
		// request would appear in requestDisablement (it would sit forward of
		// the cursor) and the chat UI would render it as a disabled turn.
		transaction(tx => {
			this._currentCheckpointIndex.set(this._checkpoints.length - 1, tx);
		});
	}

	/**
	 * Called by the session handler when a tool call begins executing on the
	 * agent host. Increments the running counter and updates running URIs so
	 * {@link isRunning} and {@link runningUris} activate the file-explorer
	 * spinner for active entries.
	 */
	notifyToolCallRunning(toolCallId: string, uris?: readonly URI[]): void {
		this._runningToolCalls.set(toolCallId, uris ?? []);
		transaction(tx => {
			this._runningCountObs.set(this._runningToolCalls.size, tx);
			this._updateRunningUris(tx);
		});

		// Proactively capture baseline snapshot for target URIs before the tool modifies disk
		if (uris && uris.length > 0) {
			for (const uri of uris) {
				const targetUri = fromAgentHostUri(uri);
				const key = targetUri.toString();
				if (!this._filePreEditSnapshots.has(key)) {
					const model = this._modelService?.getModel(targetUri);
					if (model) {
						this._filePreEditSnapshots.set(key, {
							content: model.getValue(),
							existed: true,
							capturedAt: Date.now()
						});
					} else {
						this._fileService.readFile(targetUri).then(buf => {
							if (!this._filePreEditSnapshots.has(key)) {
								this._filePreEditSnapshots.set(key, {
									content: buf.value.toString(),
									existed: true,
									capturedAt: Date.now()
								});
							}
						}).catch(() => {
							if (!this._filePreEditSnapshots.has(key)) {
								this._filePreEditSnapshots.set(key, {
									content: '',
									existed: false,
									capturedAt: Date.now()
								});
							}
						});
					}
				}
			}
		}
	}

	/**
	 * Called by the session handler when a tool call finishes (any terminal
	 * status). Decrements the running counter; when all tool calls complete
	 * the file-explorer spinner is cleared.
	 */
	notifyToolCallDone(toolCallId: string): void {
		if (!this._runningToolCalls.has(toolCallId)) {
			return;
		}
		this._runningToolCalls.delete(toolCallId);
		transaction(tx => {
			this._runningCountObs.set(this._runningToolCalls.size, tx);
			this._updateRunningUris(tx);
		});
	}

	private _updateRunningUris(tx: ITransaction): void {
		const allUris: URI[] = [];
		for (const list of this._runningToolCalls.values()) {
			for (const u of list) {
				if (!allUris.some(existing => isEqual(existing, u))) {
					allUris.push(u);
				}
			}
		}
		this._runningUrisObs.set(allUris, tx);
	}

	/**
	 * Folds a completed tool call's file edits into the checkpoint for the
	 * given request. Idempotent on `toolCallId`.
	 */
	addToolCallEdits(requestId: string, tc: ToolCallState): void {
		if (tc.status !== ToolCallStatus.Completed) {
			return;
		}

		this.ensureRequestCheckpoint(requestId);

		const cp = this._checkpoints.find(c => c.requestId === requestId);
		if (!cp || cp.seenToolCallIds.has(tc.toolCallId)) {
			return;
		}
		cp.seenToolCallIds.add(tc.toolCallId);

		const fileEdits = fileEditsToExternalEdits(tc);
		if (fileEdits.length === 0) {
			return;
		}

		const authority = this._connectionAuthority;
		for (const edit of fileEdits) {
			const resource = toAgentHostUri(edit.resource, authority);
			const targetKey = fromAgentHostUri(resource).toString();
			if (edit.diff) {
				const prev = this._aggregatedDiffsByUri.get(targetKey) ?? { added: 0, removed: 0 };
				const added = typeof edit.diff.added === 'number' ? edit.diff.added : (edit.diff.added !== undefined ? Number(edit.diff.added) : 0);
				const removed = typeof edit.diff.removed === 'number' ? edit.diff.removed : (edit.diff.removed !== undefined ? Number(edit.diff.removed) : 0);
				this._aggregatedDiffsByUri.set(targetKey, {
					added: prev.added + (isNaN(added) ? 0 : added),
					removed: prev.removed + (isNaN(removed) ? 0 : removed),
				});
			}

			const entry: IToolCallFileEdit = {
				kind: edit.kind,
				resource,
				originalResource: edit.originalResource ? toAgentHostUri(edit.originalResource, authority) : undefined,
				beforeContentUri: edit.beforeContentUri ? toAgentHostContentUri(edit.beforeContentUri, authority) : undefined,
				afterContentUri: edit.afterContentUri ? toAgentHostContentUri(edit.afterContentUri, authority) : undefined,
				undoStopId: edit.undoStopId,
				diff: edit.diff,
			};

			// Multiple tool calls in one request may touch the same file
			// (e.g. create→edit, edit→delete). Fold each new edit into the
			// prior one for the same resource so the checkpoint stores a
			// single net before/after pair per file. Otherwise
			// _writeCheckpointContent would apply duplicate writes in
			// parallel and race to leave the file in an undefined state.
			const existingIdx = cp.edits.findIndex(e => e.resource.toString() === resource.toString());
			let targetEntry: IToolCallFileEdit;
			if (existingIdx < 0) {
				cp.edits.push(entry);
				targetEntry = entry;
			} else {
				cp.edits[existingIdx] = mergeFileEdit(cp.edits[existingIdx], entry);
				targetEntry = cp.edits[existingIdx];
			}

			// Register reviewable modified file entry for Antigravity-style diff review
			this._registerModifiedFileEntry(requestId, targetEntry);
		}
	}

	// ---- Snapshots ----------------------------------------------------------

	private _findCheckpointIndex(requestId: string): number {
		return this._checkpoints.findIndex(cp => cp.requestId === requestId);
	}

	async restoreSnapshot(requestId: string, _stopId: string | undefined): Promise<void> {
		return this._undoRedoSequencer.queue(async () => {
			const cpIdx = this._findCheckpointIndex(requestId);
			if (cpIdx < 0) {
				this._logService.warn(`[AgentHostSnapshotController] No checkpoint found for requestId=${requestId}`);
				return;
			}

			// Restore to before this request: target one slot before it.
			await this._navigateToCheckpointIndex(cpIdx - 1);
		});
	}

	/**
	 * Steps a single checkpoint backwards, undoing the edits of the current
	 * checkpoint. The "Undo" UI invokes this once per click.
	 */
	async undoInteraction(): Promise<void> {
		return this._undoRedoSequencer.queue(async () => {
			const currentIdx = this._currentCheckpointIndex.get();
			if (currentIdx < 0) {
				return;
			}
			await this._navigateToCheckpointIndex(currentIdx - 1);
		});
	}

	/**
	 * Steps a single checkpoint forwards, redoing the edits of the next
	 * checkpoint.
	 *
	 * Implementing this is essential: the "Redo" action repeatedly calls this
	 * while {@link canRedo} is `true`, so a no-op implementation would spin
	 * forever and hang the window.
	 */
	async redoInteraction(): Promise<void> {
		return this._undoRedoSequencer.queue(async () => {
			const currentIdx = this._currentCheckpointIndex.get();
			if (currentIdx >= this._checkpoints.length - 1) {
				return;
			}
			await this._navigateToCheckpointIndex(currentIdx + 1);
		});
	}

	/**
	 * Moves the on-disk file state and the checkpoint cursor to `targetIdx`,
	 * writing each crossed checkpoint's before/after content. Must run inside
	 * the {@link _undoRedoSequencer} to avoid racing writes.
	 */
	private async _navigateToCheckpointIndex(targetIdx: number): Promise<void> {
		const currentIdx = this._currentCheckpointIndex.get();
		if (targetIdx < currentIdx) {
			// Undo forward checkpoints
			for (let i = currentIdx; i > targetIdx; i--) {
				await this._writeCheckpointContent(this._checkpoints[i], 'before');
			}
		} else if (targetIdx > currentIdx) {
			// Redo to reach the target
			for (let i = currentIdx + 1; i <= targetIdx; i++) {
				await this._writeCheckpointContent(this._checkpoints[i], 'after');
			}
		}

		transaction(tx => {
			this._currentCheckpointIndex.set(targetIdx, tx);
		});
	}

	getSnapshotUri(requestId: string, uri: URI, _stopId: string | undefined): URI | undefined {
		const cp = this._checkpoints.find(c => c.requestId === requestId);
		if (!cp || !cp.edits.some(e => e.resource.toString() === uri.toString())) {
			return undefined;
		}
		return URI.from({
			scheme: Schemas.chatEditingSnapshotScheme,
			path: uri.path,
			query: JSON.stringify({ session: this.chatSessionResource.toString(), requestId, undoStop: '' }),
		});
	}

	async getSnapshotContents(requestId: string, uri: URI, _stopId: string | undefined): Promise<VSBuffer | undefined> {
		const cp = this._checkpoints.find(c => c.requestId === requestId);
		if (!cp) {
			return undefined;
		}
		const uriStr = uri.toString();
		// Use the last edit for this file in the request — that's the
		// "after-content" the diff viewer wants to display.
		let edit: IToolCallFileEdit | undefined;
		for (let i = cp.edits.length - 1; i >= 0; i--) {
			if (cp.edits[i].resource.toString() === uriStr) {
				edit = cp.edits[i];
				break;
			}
		}
		if (!edit) {
			return undefined;
		}
		try {
			if (!edit.afterContentUri) {
				return VSBuffer.fromByteArray([]);
			}
			const content = await this._fileService.readFile(edit.afterContentUri);
			return content.value;
		} catch (err) {
			this._logService.warn(`[AgentHostSnapshotController] Failed to fetch snapshot content`, err);
			return undefined;
		}
	}

	async getSnapshotModel(_requestId: string, _undoStop: string | undefined, _snapshotUri: URI): Promise<ITextModel | null> {
		return null;
	}

	hasEditsInRequest(requestId: string, _reader?: IReader): boolean {
		const cp = this._checkpoints.find(c => c.requestId === requestId);
		return !!cp && cp.edits.length > 0;
	}

	// ---- Review & Diff Integration (Antigravity-style) ----------------------

	async show(_previousChanges?: boolean): Promise<void> {
		const firstModified = Array.from(this._entriesByUri.values()).find(e => e.state.get() === ModifiedFileEntryState.Modified);
		if (firstModified && this._editorService) {
			const pane = await this._editorService.openEditor({
				resource: firstModified.modifiedURI,
			});
			if (pane) {
				firstModified.getEditorIntegration(pane).reveal(true);
			}
		}
	}

	getEntry(uri: URI): IModifiedFileEntry | undefined {
		const targetUri = fromAgentHostUri(uri);
		return this._entriesByUri.get(targetUri.toString()) ?? this._entriesByUri.get(uri.toString());
	}

	readEntry(uri: URI, reader: IReader): IModifiedFileEntry | undefined {
		this._entriesObs.read(reader);
		const targetUri = fromAgentHostUri(uri);
		return this._entriesByUri.get(targetUri.toString()) ?? this._entriesByUri.get(uri.toString());
	}

	async accept(...uris: URI[]): Promise<void> {
		const targetEntries = uris.length > 0
			? uris.map(u => this._entriesByUri.get(fromAgentHostUri(u).toString()) ?? this._entriesByUri.get(u.toString())).filter(isDefined)
			: Array.from(this._entriesByUri.values()).filter(e => e.state.get() === ModifiedFileEntryState.Modified);

		for (const entry of targetEntries) {
			this._filePreEditSnapshots.delete(entry.modifiedURI.toString());
			await entry.accept();
		}
	}

	async reject(...uris: URI[]): Promise<void> {
		const targetEntries = uris.length > 0
			? uris.map(u => this._entriesByUri.get(fromAgentHostUri(u).toString()) ?? this._entriesByUri.get(u.toString())).filter(isDefined)
			: Array.from(this._entriesByUri.values()).filter(e => e.state.get() === ModifiedFileEntryState.Modified);

		for (const entry of targetEntries) {
			this._filePreEditSnapshots.delete(entry.modifiedURI.toString());
			if (entry instanceof ChatEditingModifiedDocumentEntry) {
				await entry.resetToInitialContent();
				await entry.save();
			}
			await entry.reject();
		}
	}

	getEntryDiffBetweenStops(_uri: URI, _requestId: string | undefined, _stopId: string | undefined): IObservable<IEditSessionEntryDiff | undefined> | undefined { return undefined; }
	getEntryDiffBetweenRequests(_uri: URI, _startRequestId: string, _stopRequestId: string): IObservable<IEditSessionEntryDiff | undefined> { return constObservable(undefined); }

	getDiffsForFilesInSession(): IObservable<readonly IEditSessionEntryDiff[]> {
		return derived(r => {
			const diffs: IEditSessionEntryDiff[] = [];
			for (const entry of this._entriesObs.read(r)) {
				if (entry.state.read(r) === ModifiedFileEntryState.Modified) {
					diffs.push({
						originalURI: entry.originalURI,
						modifiedURI: entry.modifiedURI,
						added: entry.linesAdded?.read(r) ?? 0,
						removed: entry.linesRemoved?.read(r) ?? 0,
						quitEarly: false,
						identical: false,
						isFinal: true,
						isBusy: false,
					});
				}
			}
			return diffs;
		});
	}

	getDiffsForFilesInRequest(_requestId: string): IObservable<readonly IEditSessionEntryDiff[]> {
		return this.getDiffsForFilesInSession();
	}

	getDiffForSession(): IObservable<IEditSessionDiffStats> {
		return derived(r => {
			let added = 0;
			let removed = 0;
			for (const entry of this._entriesObs.read(r)) {
				if (entry.state.read(r) === ModifiedFileEntryState.Modified) {
					added += entry.linesAdded?.read(r) ?? 0;
					removed += entry.linesRemoved?.read(r) ?? 0;
				}
			}
			return { added, removed };
		});
	}

	async triggerExplanationGeneration(): Promise<void> { /* no-op */ }
	clearExplanations(): void { /* no-op */ }
	hasExplanations(): boolean { return false; }

	startStreamingEdits(_resource: URI, _responseModel: IChatResponseModel, _inUndoStop: string | undefined): IStreamingEdits {
		throw new Error('Not supported for agent host sessions');
	}
	applyWorkspaceEdit(_edit: IChatWorkspaceEdit, _responseModel: IChatResponseModel, _undoStopId: string): void {
		throw new Error('Not supported for agent host sessions');
	}
	async startExternalEdits(_responseModel: IChatResponseModel, _operationId: number, _resources: URI[], _undoStopId: string, _contentFor?: URI[]): Promise<IChatProgress[]> {
		throw new Error('Not supported for agent host sessions');
	}
	async stopExternalEdits(_responseModel: IChatResponseModel, _operationId: number, _contentFor?: URI[]): Promise<IChatProgress[]> {
		throw new Error('Not supported for agent host sessions');
	}

	// ---- Stop / Dispose -----------------------------------------------------

	async stop(_clearState?: boolean): Promise<void> {
		this.dispose();
	}

	override dispose(): void {
		this._entryDisposables.dispose();
		this._filePreEditSnapshots.clear();
		this._onDidDispose.fire();
		super.dispose();
	}

	private async _registerModifiedFileEntry(requestId: string, edit: IToolCallFileEdit): Promise<void> {
		if (!this._textModelService || !this._instantiationService) {
			return;
		}

		const targetUri = fromAgentHostUri(edit.resource);
		const key = targetUri.toString();

		const previousPromise = this._pendingRegistrations.get(key) ?? Promise.resolve();
		const currentPromise = (async () => {
			await previousPromise;
			await this._doRegisterModifiedFileEntry(requestId, edit);
		})();
		this._pendingRegistrations.set(key, currentPromise);
		try {
			await currentPromise;
		} finally {
			if (this._pendingRegistrations.get(key) === currentPromise) {
				this._pendingRegistrations.delete(key);
			}
		}
	}

	private async _doRegisterModifiedFileEntry(requestId: string, edit: IToolCallFileEdit): Promise<void> {
		if (edit.kind === FileEditKind.Rename) {
			return;
		}

		const targetUri = fromAgentHostUri(edit.resource);
		const key = targetUri.toString();

		const existing = this._entriesByUri.get(key);
		if (existing && existing.state.get() === ModifiedFileEntryState.Modified) {
			const aggregatedDiff = this._aggregatedDiffsByUri.get(key) ?? edit.diff;
			if (aggregatedDiff) {
				existing.setAuthoritativeDiff?.(aggregatedDiff);
			}
			existing.startExternalEdit?.();
			try {
				await existing.revertToDisk?.();
				await existing.recomputeDiff?.();
			} finally {
				existing.stopExternalEdit?.();
			}
			if (aggregatedDiff) {
				existing.setAuthoritativeDiff?.(aggregatedDiff);
			}
			transaction(tx => {
				this._entriesObs.set(Array.from(this._entriesByUri.values()), tx);
			});
			return;
		}

		let initialContent: string | undefined;
		if (edit.kind === FileEditKind.Create) {
			initialContent = '';
		} else if (edit.beforeContentUri) {
			try {
				const buf = await this._fileService.readFile(edit.beforeContentUri);
				initialContent = buf.value.toString();
			} catch (err) {
				this._logService.trace(`[AgentHostSnapshotController] Could not read beforeContentUri for ${targetUri.toString()}`, err);
			}
		}

		// Tier 3: Pre-edit snapshot captured proactively when tool call started running
		if (initialContent === undefined) {
			const preSnap = this._filePreEditSnapshots.get(key);
			if (preSnap) {
				initialContent = preSnap.content;
			}
		}

		// Tier 4: Working copy history service
		if (initialContent === undefined && this._workingCopyHistoryService) {
			try {
				const entries = await this._workingCopyHistoryService.getEntries(targetUri, CancellationToken.None);
				if (entries.length > 0) {
					const lastEntry = entries[entries.length - 1];
					const histBuf = await this._fileService.readFile(lastEntry.location);
					initialContent = histBuf.value.toString();
				}
			} catch (err) {
				this._logService.trace(`[AgentHostSnapshotController] Could not read workingCopyHistory for ${targetUri.toString()}`, err);
			}
		}

		// Tier 5: SCM / Git HEAD original resolution
		if (initialContent === undefined) {
			initialContent = await this._resolveGitHeadContent(targetUri);
		}

		const telemetryInfo: IModifiedEntryTelemetryInfo = {
			sessionResource: this.chatSessionResource,
			requestId,
			result: undefined,
			agentId: undefined,
			command: undefined,
			modelId: undefined,
			modeId: 'agent',
			applyCodeBlockSuggestionId: undefined,
			feature: 'sideBarChat',
		};

		const multiDiffEntryDelegate = {
			collapse: () => { },
		};

		try {
			let entry: IModifiedFileEntry & IDisposable;
			if (edit.kind === FileEditKind.Delete) {
				entry = this._instantiationService.createInstance(
					ChatEditingDeletedFileEntry,
					targetUri,
					initialContent ?? '',
					multiDiffEntryDelegate,
					telemetryInfo,
					'plaintext',
				);
			} else {
				const kind = edit.kind === FileEditKind.Create ? ChatEditKind.Created : ChatEditKind.Modified;
				const ref = await this._textModelService.createModelReference(targetUri);
				entry = this._instantiationService.createInstance(
					ChatEditingModifiedDocumentEntry,
					ref,
					multiDiffEntryDelegate,
					telemetryInfo,
					kind,
					initialContent,
				);
				const aggregatedDiff = this._aggregatedDiffsByUri.get(key) ?? edit.diff;
				if (aggregatedDiff) {
					entry.setAuthoritativeDiff?.(aggregatedDiff);
				}
			}

			this._entryDisposables.add(entry);
			this._entriesByUri.set(key, entry);

			this._entryDisposables.add(autorun(reader => {
				entry.state.read(reader);
				transaction(tx => {
					this._entriesObs.set(Array.from(this._entriesByUri.values()), tx);
				});
			}));

			transaction(tx => {
				this._entriesObs.set(Array.from(this._entriesByUri.values()), tx);
			});
		} catch (err) {
			this._logService.warn(`[AgentHostSnapshotController] Failed to create IModifiedFileEntry for ${targetUri.toString()}`, err);
		}
	}

	private async _resolveGitHeadContent(targetUri: URI): Promise<string | undefined> {
		if (!this._quickDiffService) {
			return undefined;
		}
		try {
			const diffs = await this._quickDiffService.getQuickDiffs(targetUri);
			for (const diff of diffs) {
				if (diff.originalResource) {
					const content = await this._fileService.readFile(diff.originalResource);
					return content.value.toString();
				}
			}
		} catch (err) {
			this._logService.trace(`[AgentHostSnapshotController] Could not resolve quick diff original for ${targetUri.toString()}`, err);
		}
		return undefined;
	}

	// ---- Private helpers ----------------------------------------------------

	private async _writeCheckpointContent(checkpoint: IAgentHostCheckpoint, direction: 'before' | 'after'): Promise<void> {
		const ops = checkpoint.edits.map(async edit => {
			try {
				if (direction === 'before') {
					// Undoing this edit
					switch (edit.kind) {
						case FileEditKind.Create:
							await this._fileService.del(edit.resource);
							break;
						case FileEditKind.Delete:
							if (edit.beforeContentUri) {
								const content = await this._fileService.readFile(edit.beforeContentUri);
								await this._fileService.writeFile(edit.resource, content.value);
							}
							break;
						case FileEditKind.Rename:
							if (edit.originalResource) {
								await this._fileService.move(edit.resource, edit.originalResource, true);
							}
							if (edit.beforeContentUri && edit.originalResource) {
								const content = await this._fileService.readFile(edit.beforeContentUri);
								await this._fileService.writeFile(edit.originalResource, content.value);
							}
							break;
						case FileEditKind.Edit:
							if (edit.beforeContentUri) {
								const content = await this._fileService.readFile(edit.beforeContentUri);
								await this._fileService.writeFile(edit.resource, content.value);
							}
							break;
					}
				} else {
					// Redoing this edit
					switch (edit.kind) {
						case FileEditKind.Create:
							if (edit.afterContentUri) {
								const content = await this._fileService.readFile(edit.afterContentUri);
								await this._fileService.writeFile(edit.resource, content.value);
							}
							break;
						case FileEditKind.Delete:
							await this._fileService.del(edit.resource);
							break;
						case FileEditKind.Rename:
							if (edit.originalResource) {
								await this._fileService.move(edit.originalResource, edit.resource, true);
							}
							if (edit.afterContentUri) {
								const content = await this._fileService.readFile(edit.afterContentUri);
								await this._fileService.writeFile(edit.resource, content.value);
							}
							break;
						case FileEditKind.Edit:
							if (edit.afterContentUri) {
								const content = await this._fileService.readFile(edit.afterContentUri);
								await this._fileService.writeFile(edit.resource, content.value);
							}
							break;
					}
				}
			} catch (err) {
				this._logService.warn(`[AgentHostSnapshotController] Failed to ${direction === 'before' ? 'undo' : 'redo'} ${edit.kind} for ${edit.resource.toString()}`, err);
			}
		});
		await Promise.all(ops);
	}
}

/**
 * Combines two edits to the same file (in arrival order) into a single net
 * edit. The merged entry keeps the earlier `before` snapshot and the later
 * `after` snapshot, and derives a net `kind` based on whether the file
 * exists at the start and end of the combined operation.
 *
 * A create-then-delete collapses to a no-op edit (no before, no after) — we
 * still keep the entry so the file is restored to "absent" on undo, but
 * `_writeCheckpointContent` will skip the write since both URIs are absent.
 */
function mergeFileEdit(prev: IToolCallFileEdit, next: IToolCallFileEdit): IToolCallFileEdit {
	const startsAbsent = prev.kind === FileEditKind.Create;
	const endsAbsent = next.kind === FileEditKind.Delete;

	let kind: FileEditKind;
	if (startsAbsent && endsAbsent) {
		kind = FileEditKind.Edit; // create+delete collapses to no-op
	} else if (startsAbsent) {
		kind = FileEditKind.Create;
	} else if (endsAbsent) {
		kind = FileEditKind.Delete;
	} else {
		kind = FileEditKind.Edit;
	}

	let diff: { added?: number; removed?: number } | undefined;
	if (prev.diff || next.diff) {
		const prevAdded = typeof prev.diff?.added === 'number' ? prev.diff.added : (prev.diff?.added !== undefined ? Number(prev.diff.added) : 0);
		const nextAdded = typeof next.diff?.added === 'number' ? next.diff.added : (next.diff?.added !== undefined ? Number(next.diff.added) : 0);
		const prevRemoved = typeof prev.diff?.removed === 'number' ? prev.diff.removed : (prev.diff?.removed !== undefined ? Number(prev.diff.removed) : 0);
		const nextRemoved = typeof next.diff?.removed === 'number' ? next.diff.removed : (next.diff?.removed !== undefined ? Number(next.diff.removed) : 0);
		diff = {
			added: (isNaN(prevAdded) ? 0 : prevAdded) + (isNaN(nextAdded) ? 0 : nextAdded),
			removed: (isNaN(prevRemoved) ? 0 : prevRemoved) + (isNaN(nextRemoved) ? 0 : nextRemoved),
		};
	}

	return {
		kind,
		resource: next.resource,
		// Renames within a single request are uncommon; if the second edit
		// is itself a rename keep its originalResource, otherwise carry
		// forward the first one.
		originalResource: next.originalResource ?? prev.originalResource,
		beforeContentUri: prev.beforeContentUri,
		afterContentUri: next.afterContentUri,
		undoStopId: prev.undoStopId,
		diff,
	};
}
