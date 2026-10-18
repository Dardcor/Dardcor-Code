/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeHex, encodeHex, VSBuffer } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { CancellationError } from '../../../../../base/common/errors.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { autorunSelfDisposable, IObservable, IReader } from '../../../../../base/common/observable.js';
import { hasKey } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { IDocumentDiff } from '../../../../../editor/common/diff/documentDiffProvider.js';
import { TextEdit } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { EditSuggestionId } from '../../../../../editor/common/textModelEditSource.js';
import { localize } from '../../../../../nls.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEditorPane } from '../../../../common/editor.js';
import { ICellEditOperation } from '../../../notebook/common/notebookCommon.js';
import { IChatMultiDiffData, IChatMultiDiffDataSerialized, IChatProgress, IChatWorkspaceEdit } from '../chatService/chatService.js';
import { ChatModel, IChatRequestDisablement, IChatResponseModel } from '../model/chatModel.js';
import { IChatAgentResult } from '../participants/chatAgents.js';

export const IChatEditingService = createDecorator<IChatEditingService>('chatEditingService');

export interface IChatEditingSessionProvider {
	createEditingSession(chatSessionResource: URI): IChatEditingSession;
}

export interface IChatEditingService {

	_serviceBrand: undefined;

	startOrContinueGlobalEditingSession(chatModel: ChatModel): IChatEditingSession;

	getEditingSession(chatSessionResource: URI): IChatEditingSession | undefined;

	readonly editingSessionsObs: IObservable<readonly IChatEditReviewSession[]>;

	createEditingSession(chatModel: ChatModel): IChatEditingSession;

	registerEditReviewSession(session: IChatEditReviewSession): IDisposable;

	transferEditingSession(chatModel: ChatModel, session: IChatEditingSession): IChatEditingSession;

	registerEditingSessionProvider(scheme: string, provider: IChatEditingSessionProvider): IDisposable;

	setSessionRunning?(sessionResource: URI, running: boolean, uris?: readonly URI[]): void;

	registerFileEdit?(sessionResource: URI, targetUri: URI, kind: 'create' | 'edit' | 'delete', initialContent: string | undefined, requestId: string, undoStopId?: string, diff?: { added: number; removed: number }): Promise<void>;
}

export interface WorkingSetDisplayMetadata {
	state: ModifiedFileEntryState;
	description?: string;
}

export interface IStreamingEdits {
	pushText(edits: TextEdit[], isLastEdits: boolean): void;
	pushNotebookCellText(cell: URI, edits: TextEdit[], isLastEdits: boolean): void;
	pushNotebook(edits: ICellEditOperation[], isLastEdits: boolean): void;
	complete(): void;
}

export interface IModifiedEntryTelemetryInfo {
	readonly agentId: string | undefined;
	readonly command: string | undefined;
	readonly sessionResource: URI;
	readonly requestId: string;
	readonly result: IChatAgentResult | undefined;
	readonly modelId: string | undefined;
	readonly modeId: 'ask' | 'edit' | 'agent' | 'custom' | 'applyCodeBlock' | undefined;
	readonly applyCodeBlockSuggestionId: EditSuggestionId | undefined;
	readonly feature: 'sideBarChat' | 'inlineChat' | undefined;
}

export interface ISnapshotEntry {
	readonly resource: URI;
	readonly languageId: string;
	readonly snapshotUri: URI;
	readonly original: string;
	readonly current: string;
	readonly state: ModifiedFileEntryState;
	telemetryInfo: IModifiedEntryTelemetryInfo;
	readonly isDeleted?: boolean;
}

export interface IChatEditReviewSession extends IDisposable {
	readonly isGlobalEditingSession: boolean;
	readonly chatSessionResource: URI;
	readonly onDidDispose: Event<void>;
	readonly entries: IObservable<readonly IModifiedFileEntry[]>;
	getEntry(uri: URI): IModifiedFileEntry | undefined;
	readEntry(uri: URI, reader: IReader): IModifiedFileEntry | undefined;
	accept(...uris: URI[]): Promise<void>;
	reject(...uris: URI[]): Promise<void>;
	readonly isRunning?: IObservable<boolean>;
	readonly runningUris?: IObservable<readonly URI[]>;
}

export interface IChatEditingSession extends IChatEditReviewSession {
	readonly supportsKeepUndo: boolean;
	readonly state: IObservable<ChatEditingSessionState>;
	readonly requestDisablement: IObservable<IChatRequestDisablement[]>;

	show(previousChanges?: boolean): Promise<void>;
	restoreSnapshot(requestId: string, stopId: string | undefined): Promise<void>;

	startExternalEdits(responseModel: IChatResponseModel, operationId: number, resources: URI[], undoStopId: string, contentFor?: URI[]): Promise<IChatProgress[]>;
	stopExternalEdits(responseModel: IChatResponseModel, operationId: number, contentFor?: URI[]): Promise<IChatProgress[]>;

	getSnapshotUri(requestId: string, uri: URI, stopId: string | undefined): URI | undefined;

	getSnapshotContents(requestId: string, uri: URI, stopId: string | undefined): Promise<VSBuffer | undefined>;
	getSnapshotModel(requestId: string, undoStop: string | undefined, snapshotUri: URI): Promise<ITextModel | null>;

	stop(clearState?: boolean): Promise<void>;

	startStreamingEdits(resource: URI, responseModel: IChatResponseModel, inUndoStop: string | undefined): IStreamingEdits;

	applyWorkspaceEdit(edit: IChatWorkspaceEdit, responseModel: IChatResponseModel, undoStopId: string): void;

	getEntryDiffBetweenStops(uri: URI, requestId: string | undefined, stopId: string | undefined): IObservable<IEditSessionEntryDiff | undefined> | undefined;

	getEntryDiffBetweenRequests(uri: URI, startRequestIs: string, stopRequestId: string): IObservable<IEditSessionEntryDiff | undefined>;

	getDiffsForFilesInSession(): IObservable<readonly IEditSessionEntryDiff[]>;

	getDiffsForFilesInRequest(requestId: string): IObservable<readonly IEditSessionEntryDiff[]>;

	hasEditsInRequest(requestId: string, reader?: IReader): boolean;

	getDiffForSession(): IObservable<IEditSessionDiffStats>;

	readonly canUndo: IObservable<boolean>;
	readonly canRedo: IObservable<boolean>;
	undoInteraction(): Promise<void>;
	redoInteraction(): Promise<void>;

	triggerExplanationGeneration(): Promise<void>;

	clearExplanations(): void;

	hasExplanations(): boolean;

	setRunning?(running: boolean, uris?: readonly URI[]): void;

	registerFileEdit?(targetUri: URI, kind: 'create' | 'edit' | 'delete', initialContent: string | undefined, requestId: string, undoStopId?: string, diff?: { added: number; removed: number }): Promise<void>;
}

export function chatEditingSessionIsReady(session: IChatEditingSession): Promise<void> {
	return new Promise<void>(resolve => {
		autorunSelfDisposable(reader => {
			const state = session.state.read(reader);
			if (state !== ChatEditingSessionState.Initial) {
				reader.dispose();
				resolve();
			}
		});
	});
}

export function editEntriesToMultiDiffData(entriesObs: IObservable<readonly IEditSessionEntryDiff[]>): IChatMultiDiffData {
	const multiDiffData = entriesObs.map(entries => ({
		title: localize('chatMultidiff.autoGenerated', 'Changes to {0} files', entries.length),
		resources: entries.map(entry => ({
			originalUri: entry.originalURI,
			modifiedUri: entry.modifiedURI,
			goToFileUri: entry.modifiedURI,
			added: entry.added,
			removed: entry.removed,
		}))
	}));

	return {
		kind: 'multiDiffData',
		collapsed: true,
		multiDiffData,
		toJSON(): IChatMultiDiffDataSerialized {
			return {
				kind: 'multiDiffData',
				collapsed: this.collapsed,
				multiDiffData: multiDiffData.get(),
			};
		}
	};
}

export function awaitCompleteChatEditingDiff(diff: IObservable<IEditSessionEntryDiff>, token?: CancellationToken): Promise<IEditSessionEntryDiff>;
export function awaitCompleteChatEditingDiff(diff: IObservable<readonly IEditSessionEntryDiff[]>, token?: CancellationToken): Promise<readonly IEditSessionEntryDiff[]>;
export function awaitCompleteChatEditingDiff(diff: IObservable<readonly IEditSessionEntryDiff[] | IEditSessionEntryDiff>, token?: CancellationToken): Promise<readonly IEditSessionEntryDiff[] | IEditSessionEntryDiff> {
	return new Promise<readonly IEditSessionEntryDiff[] | IEditSessionEntryDiff>((resolve, reject) => {
		autorunSelfDisposable(reader => {
			if (token) {
				if (token.isCancellationRequested) {
					reader.dispose();
					return reject(new CancellationError());
				}
				reader.store.add(token.onCancellationRequested(() => {
					reader.dispose();
					reject(new CancellationError());
				}));
			}

			const current = diff.read(reader);
			if (current instanceof Array) {
				if (!current.some(c => c.isBusy)) {
					reader.dispose();
					resolve(current);
				}
			} else if (!current.isBusy) {
				reader.dispose();
				resolve(current);
			}
		});
	});
}

export interface IEditSessionDiffStats {
	added: number;
	removed: number;
}

export interface IEditSessionEntryDiff extends IEditSessionDiffStats {
	originalURI: URI;
	modifiedURI: URI;

	modifiedSnapshotURI?: URI;

	isCreated?: boolean;

	isDeleted?: boolean;

	quitEarly: boolean;
	identical: boolean;

	isFinal: boolean;

	isBusy: boolean;
}

export function emptySessionEntryDiff(originalURI: URI, modifiedURI: URI): IEditSessionEntryDiff {
	return {
		originalURI,
		modifiedURI,
		added: 0,
		removed: 0,
		quitEarly: false,
		identical: false,
		isFinal: false,
		isBusy: false,
	};
}

export const enum ModifiedFileEntryState {
	Modified,
	Accepted,
	Rejected,
}

export interface IModifiedFileEntryChangeHunk {
	accept(): Promise<boolean>;
	reject(): Promise<boolean>;
}

export interface IModifiedFileEntryEditorIntegration extends IDisposable {

	currentIndex: IObservable<number>;

	reveal(firstOrLast: boolean, preserveFocus?: boolean): void;

	next(wrap: boolean): boolean;

	previous(wrap: boolean): boolean;

	enableAccessibleDiffView(): void;

	acceptNearestChange(change?: IModifiedFileEntryChangeHunk): Promise<void>;

	rejectNearestChange(change?: IModifiedFileEntryChangeHunk): Promise<void>;

	toggleDiff(change: IModifiedFileEntryChangeHunk | undefined, show?: boolean): Promise<void>;
}

export interface IModifiedFileEntry {
	readonly entryId: string;
	readonly originalURI: URI;
	readonly modifiedURI: URI;
	readonly isDeletion?: boolean;

	readonly lastModifyingRequestId: string;

	readonly state: IObservable<ModifiedFileEntryState>;
	readonly isCurrentlyBeingModifiedBy: IObservable<{ responseModel: IChatResponseModel; undoStopId: string | undefined } | undefined>;
	readonly lastModifyingResponse: IObservable<IChatResponseModel | undefined>;
	readonly rewriteRatio: IObservable<number>;

	readonly waitsForLastEdits: IObservable<boolean>;

	accept(): Promise<void>;
	reject(): Promise<void>;

	reviewMode: IObservable<boolean>;
	autoAcceptController: IObservable<{ total: number; remaining: number; cancel(): void } | undefined>;
	enableReviewModeUntilSettled(): void;

	readonly changesCount: IObservable<number>;

	readonly diffInfo?: IObservable<IDocumentDiff>;

	readonly linesAdded?: IObservable<number>;

	readonly linesRemoved?: IObservable<number>;

	getEditorIntegration(editor: IEditorPane): IModifiedFileEntryEditorIntegration;
	getDiffInfo?(): Promise<IDocumentDiff>;
	setAuthoritativeDiff?(diff: { added?: number; removed?: number } | undefined): void;
	recomputeDiff?(): Promise<void>;
	updateOriginalContent?(content: string): Promise<void>;
	revertToDisk?(): Promise<void>;
	startExternalEdit?(): void;
	stopExternalEdit?(): void;
}

export interface IChatEditingSessionStream {
	textEdits(resource: URI, textEdits: TextEdit[], isLastEdits: boolean, responseModel: IChatResponseModel): void;
	notebookEdits(resource: URI, edits: ICellEditOperation[], isLastEdits: boolean, responseModel: IChatResponseModel): void;
}

export const enum ChatEditingSessionState {
	Initial = 0,
	StreamingEdits = 1,
	Idle = 2,
	Disposed = 3
}

export const CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME = 'chat-editing-multi-diff-source';

export const chatEditingWidgetFileStateContextKey = new RawContextKey<ModifiedFileEntryState>('chatEditingWidgetFileState', undefined, localize('chatEditingWidgetFileState', "The current state of the file in the chat editing widget"));
export const chatEditingAgentSupportsReadonlyReferencesContextKey = new RawContextKey<boolean>('chatEditingAgentSupportsReadonlyReferences', undefined, localize('chatEditingAgentSupportsReadonlyReferences', "Whether the chat editing agent supports readonly references (temporary)"));
export const decidedChatEditingResourceContextKey = new RawContextKey<string[]>('decidedChatEditingResource', []);
export const chatEditingResourceContextKey = new RawContextKey<string | undefined>('chatEditingResource', undefined);
export const inChatEditingSessionContextKey = new RawContextKey<boolean | undefined>('inChatEditingSession', undefined);
export const hasUndecidedChatEditingResourceContextKey = new RawContextKey<boolean | undefined>('hasUndecidedChatEditingResource', false);
export const hasAppliedChatEditsContextKey = new RawContextKey<boolean | undefined>('hasAppliedChatEdits', false);
export const applyingChatEditsFailedContextKey = new RawContextKey<boolean | undefined>('applyingChatEditsFailed', false);

export const chatEditingMaxFileAssignmentName = 'chatEditingSessionFileLimit';
export const defaultChatEditingMaxFileLimit = 10;

export const enum ChatEditKind {
	Created,
	Modified,
	Deleted,
}

export interface IChatEditingActionContext {
	sessionResource: URI;
}

export function isChatEditingActionContext(thing: unknown): thing is IChatEditingActionContext {
	return typeof thing === 'object' && !!thing && hasKey(thing, { sessionResource: true });
}

export function getMultiDiffSourceUri(session: IChatEditingSession, showPreviousChanges?: boolean): URI {
	return URI.from({
		scheme: CHAT_EDITING_MULTI_DIFF_SOURCE_RESOLVER_SCHEME,
		authority: encodeHex(VSBuffer.fromString(session.chatSessionResource.toString())),
		query: showPreviousChanges ? 'previous' : undefined,
	});
}

export function parseChatMultiDiffUri(uri: URI): { chatSessionResource: URI; showPreviousChanges: boolean } {
	const chatSessionResource = URI.parse(decodeHex(uri.authority).toString());
	const showPreviousChanges = uri.query === 'previous';

	return { chatSessionResource, showPreviousChanges };
}
