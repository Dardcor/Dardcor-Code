/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, IReference } from '../../../base/common/lifecycle.js';
import { extUriBiasedIgnorePathCase, normalizePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { Event } from '../../../base/common/event.js';
import type { FileEditKind, Message } from './state/sessionState.js';

export const ISessionDataService = createDecorator<ISessionDataService>('sessionDataService');

export const SESSION_DB_FILENAME = 'session.db';

export const SESSION_ATTACHMENTS_DIRNAME = 'attachments';

export function isSessionAttachmentPath(sessionDataService: ISessionDataService, session: URI, filePath: string): boolean {
	const attachmentsDir = normalizePath(URI.joinPath(sessionDataService.getSessionDataDir(session), SESSION_ATTACHMENTS_DIRNAME));
	const fileUri = normalizePath(URI.file(filePath));
	return extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, attachmentsDir);
}


export interface IFileEditRecord {
	turnId: string;
	toolCallId: string;
	filePath: string;
	kind: FileEditKind;
	originalPath?: string;
	addedLines: number | undefined;
	removedLines: number | undefined;
}

export interface IFileEditContent {
	beforeContent?: Uint8Array;
	afterContent?: Uint8Array;
}


export interface IReviewedFileRecord {
	uri: URI;
	nonce: string;
}


export interface ILocalTurnRecord {
	turnId: string;
	chatUri: string;
	anchorTurnId: string | undefined;
	seq: number;
	payload: string;
}


export interface ISessionDatabase extends IDisposable {
	createTurn(turnId: string): Promise<void>;

	deleteTurn(turnId: string): Promise<void>;

	setTurnEventId(turnId: string, eventId: string): Promise<void>;

	getTurnEventId(turnId: string): Promise<string | undefined>;

	getNextTurnEventId(turnId: string): Promise<string | undefined>;

	getFirstTurnEventId(): Promise<string | undefined>;

	setTurnUsage(turnId: string, usage: string): Promise<void>;

	getTurnUsages(): Promise<Map<string, string>>;

	setTurnDelegation(turnId: string, delegation: string): Promise<void>;

	getTurnDelegations(): Promise<Map<string, string>>;

	setTurnWorkspaceTransition(turnId: string, transition: string): Promise<void>;

	setWorkspaceConversion(turnId: string, transition: string, metadata: Readonly<Record<string, string>>): Promise<void>;

	deleteTurnWorkspaceTransition(turnId: string): Promise<void>;

	getTurnWorkspaceTransitions(): Promise<Map<string, string>>;

	setTurnCheckpointRef(turnId: string, ref: string): Promise<void>;

	getTurnCheckpointRef(turnId: string): Promise<string | undefined>;

	getPreviousCheckpointRef(turnId: string): Promise<string | undefined>;

	getAllCheckpointRefs(): Promise<string[]>;

	truncateFromTurn(turnId: string): Promise<void>;

	deleteTurnsAfter(turnId: string): Promise<void>;

	deleteAllTurns(): Promise<void>;


	insertLocalTurn(record: ILocalTurnRecord): Promise<void>;

	getLocalTurns(): Promise<ILocalTurnRecord[]>;

	deleteLocalTurns(turnIds: readonly string[]): Promise<void>;

	storeFileEdit(edit: IFileEditRecord & IFileEditContent): Promise<void>;

	getFileEdits(toolCallIds: string[]): Promise<IFileEditRecord[]>;

	getAllFileEdits(): Promise<IFileEditRecord[]>;

	getFileEditsByTurn(turnId: string): Promise<IFileEditRecord[]>;

	readFileEditContent(toolCallId: string, filePath: string): Promise<IFileEditContent | undefined>;


	getMetadata(key: string): Promise<string | undefined>;

	getMetadataObject<T extends Record<string, unknown>>(obj: T): Promise<{ [K in keyof T]: string | undefined }>;

	setMetadata(key: string, value: string): Promise<void>;

	setMetadataValues(values: Readonly<Record<string, string>>): Promise<void>;

	deleteMetadata(keys: readonly string[]): Promise<void>;

	setMetadataValuesIfAbsent(key: string, values: Readonly<Record<string, string>>, copies?: Readonly<Record<string, string>>): Promise<boolean>;

	setChatDraft(chat: URI, draft: Message | undefined): Promise<void>;

	getChatDraft(chat: URI): Promise<Message | undefined>;

	remapTurnIds(mapping: ReadonlyMap<string, string>, eventIds?: ReadonlyMap<string, string>): Promise<void>;


	markFileReviewed(uri: URI, nonce: string): Promise<void>;

	unmarkFileReviewed(uri: URI, nonce: string): Promise<void>;

	getReviewedFiles(): Promise<IReviewedFileRecord[]>;

	getReviewedFilesForUri(uri: URI): Promise<IReviewedFileRecord[]>;

	isFileReviewed(uri: URI, nonce: string): Promise<boolean>;

	vacuumInto(targetPath: string): Promise<void>;

	whenIdle(): Promise<void>;

	close(): Promise<void>;
}

export interface ISessionDataService {
	readonly _serviceBrand: undefined;

	getSessionDataDir(session: URI): URI;

	getSessionDataDirById(sessionId: string): URI;
	listSessionDataIds?(prefix: string): Promise<readonly string[]>;

	openDatabase(session: URI): IReference<ISessionDatabase>;

	tryOpenDatabase(session: URI): Promise<IReference<ISessionDatabase> | undefined>;

	deleteSessionData(session: URI, workingDirectories?: readonly string[]): Promise<void>;

	readonly onWillDeleteSessionData: Event<IWillDeleteSessionDataEvent>;

	cleanupOrphanedData(knownSessionIds: Set<string>): Promise<void>;

	whenIdle(): Promise<void>;
}

export interface IWillDeleteSessionDataEvent {
	readonly session: URI;
	readonly workingDirectories: readonly string[] | undefined;
	waitUntil(promise: Promise<unknown>): void;
}
