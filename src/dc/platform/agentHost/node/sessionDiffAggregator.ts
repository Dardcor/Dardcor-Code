/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { extUriBiasedIgnorePathCase } from '../../../base/common/resources.js';
import type { IFileEditRecord, ISessionDatabase } from '../common/sessionDataService.js';
import type { IDiffComputeService } from '../common/diffComputeService.js';
import { FileEditKind, type ISessionFileDiff } from '../common/state/sessionState.js';
import { buildSessionDbUri } from '../common/sessionDbUri.js';

function getFileEditUri(diff: ISessionFileDiff): string | undefined {
	return diff.after?.uri ?? diff.before?.uri;
}

function createSessionFileDiff(beforeSessionUri: string, afterSessionUri: string, identity: IFileIdentity, added: number, removed: number): ISessionFileDiff {
	const hasBefore = identity.firstKind !== FileEditKind.Create;
	const hasAfter = identity.lastKind !== FileEditKind.Delete;
	return {
		...(hasBefore ? {
			before: {
				uri: URI.file(identity.firstFilePath).toString(),
				content: { uri: buildSessionDbUri(beforeSessionUri, identity.firstToolCallId, identity.firstFilePath, 'before') },
			},
		} : {}),
		...(hasAfter ? {
			after: {
				uri: URI.file(identity.terminalPath).toString(),
				content: { uri: buildSessionDbUri(afterSessionUri, identity.lastToolCallId, identity.lastFilePath, 'after') },
			},
		} : {}),
		diff: { added, removed },
	};
}

interface IFileIdentity {
	terminalPath: string;
	firstToolCallId: string;
	firstFilePath: string;
	firstKind: FileEditKind;
	firstSourceIdx: number;
	lastToolCallId: string;
	lastFilePath: string;
	lastKind: FileEditKind;
	lastSourceIdx: number;
}

export interface ISessionDiffSource {
	sessionUri: string;
	db: ISessionDatabase;
}

export interface IIncrementalDiffOptions {
	changedTurnId: string;
	previousDiffs: ISessionFileDiff[];
}

export async function computeSessionDiffs(
	sessionUri: string,
	db: ISessionDatabase,
	diffService: IDiffComputeService,
	incremental?: IIncrementalDiffOptions,
	folderScope?: readonly URI[],
): Promise<ISessionFileDiff[]> {
	if (incremental && folderScope) {
		throw new Error('computeSessionDiffs: `folderScope` is not supported in incremental mode; call full-recompute mode (omit `incremental`) when a folder scope is required.');
	}

	if (!incremental) {
		return computeUnionedDiffs([{ sessionUri, db }], diffService, folderScope);
	}

	let edits: IFileEditRecord[];
	let fastPath = false;

	const turnEdits = await db.getFileEditsByTurn(incremental.changedTurnId);
	if (turnEdits.length === 0) {
		return [...incremental.previousDiffs];
	}

	const previousDiffsUris = new Set(incremental.previousDiffs.map(getFileEditUri));
	const needsFullHistory = turnEdits.some(e =>
		e.kind === FileEditKind.Rename ||
		previousDiffsUris.has(URI.file(e.filePath).toString())
	);

	if (needsFullHistory) {
		edits = await db.getAllFileEdits();
	} else {
		edits = turnEdits;
		fastPath = true;
	}

	if (edits.length === 0) {
		return [];
	}


	const pathToIdentityKey = new Map<string, string>();
	const identities = new Map<string, IFileIdentity>();
	const touchedIdentityKeys = !fastPath ? new Set<string>() : undefined;

	for (const edit of edits) {
		let identityKey: string;

		if (edit.kind === FileEditKind.Rename && edit.originalPath) {
			identityKey = pathToIdentityKey.get(edit.originalPath) ?? edit.originalPath;
			pathToIdentityKey.set(edit.filePath, identityKey);
			pathToIdentityKey.delete(edit.originalPath);
		} else {
			identityKey = pathToIdentityKey.get(edit.filePath) ?? edit.filePath;
			pathToIdentityKey.set(edit.filePath, identityKey);
		}

		if (touchedIdentityKeys && edit.turnId === incremental.changedTurnId) {
			touchedIdentityKeys.add(identityKey);
		}

		const existing = identities.get(identityKey);
		if (!existing) {
			identities.set(identityKey, {
				terminalPath: edit.filePath,
				firstToolCallId: edit.toolCallId,
				firstFilePath: edit.kind === FileEditKind.Rename && edit.originalPath ? edit.originalPath : edit.filePath,
				firstKind: edit.kind,
				firstSourceIdx: 0,
				lastToolCallId: edit.toolCallId,
				lastFilePath: edit.filePath,
				lastKind: edit.kind,
				lastSourceIdx: 0,
			});
		} else {
			existing.terminalPath = edit.filePath;
			existing.lastToolCallId = edit.toolCallId;
			existing.lastFilePath = edit.filePath;
			existing.lastKind = edit.kind;
		}
	}

	const previousDiffsMap = !fastPath
		? new Map(incremental.previousDiffs.map(d => [getFileEditUri(d), d]))
		: undefined;

	const results: ISessionFileDiff[] = [];
	const diffPromises: Promise<void>[] = [];

	for (const [identityKey, identity] of identities) {
		if (touchedIdentityKeys && !touchedIdentityKeys.has(identityKey)) {
			const uri = URI.file(identity.terminalPath).toString();
			const prev = previousDiffsMap!.get(uri);
			if (prev) {
				results.push(prev);
			}
			continue;
		}

		diffPromises.push((async () => {
			let beforeText: string;
			if (identity.firstKind === FileEditKind.Create) {
				beforeText = '';
			} else {
				const content = await db.readFileEditContent(identity.firstToolCallId, identity.firstFilePath);
				beforeText = content?.beforeContent ? new TextDecoder().decode(content.beforeContent) : '';
			}

			let afterText: string;
			if (identity.lastKind === FileEditKind.Delete) {
				afterText = '';
			} else {
				const content = await db.readFileEditContent(identity.lastToolCallId, identity.lastFilePath);
				afterText = content?.afterContent ? new TextDecoder().decode(content.afterContent) : '';
			}

			if (beforeText === afterText) {
				return;
			}

			const counts = await diffService.computeDiffCounts(beforeText, afterText);
			results.push(createSessionFileDiff(sessionUri, sessionUri, identity, counts.added, counts.removed));
		})());
	}

	await Promise.allSettled(diffPromises);

	if (fastPath) {
		results.push(...incremental.previousDiffs);
	}

	return results;
}

export async function computeUnionedDiffs(
	sources: readonly ISessionDiffSource[],
	diffService: IDiffComputeService,
	folderScope?: readonly URI[],
): Promise<ISessionFileDiff[]> {
	const perSourceEdits = await Promise.all(sources.map(source => source.db.getAllFileEdits()));

	const pathToIdentityKey = new Map<string, string>();
	const identities = new Map<string, IFileIdentity>();
	let totalEdits = 0;

	for (let sourceIdx = 0; sourceIdx < perSourceEdits.length; sourceIdx++) {
		for (const edit of perSourceEdits[sourceIdx]) {
			totalEdits++;
			let identityKey: string;

			if (edit.kind === FileEditKind.Rename && edit.originalPath) {
				identityKey = pathToIdentityKey.get(edit.originalPath) ?? edit.originalPath;
				pathToIdentityKey.set(edit.filePath, identityKey);
				pathToIdentityKey.delete(edit.originalPath);
			} else {
				identityKey = pathToIdentityKey.get(edit.filePath) ?? edit.filePath;
				pathToIdentityKey.set(edit.filePath, identityKey);
			}

			const existing = identities.get(identityKey);
			if (!existing) {
				identities.set(identityKey, {
					terminalPath: edit.filePath,
					firstToolCallId: edit.toolCallId,
					firstFilePath: edit.kind === FileEditKind.Rename && edit.originalPath ? edit.originalPath : edit.filePath,
					firstKind: edit.kind,
					firstSourceIdx: sourceIdx,
					lastToolCallId: edit.toolCallId,
					lastFilePath: edit.filePath,
					lastKind: edit.kind,
					lastSourceIdx: sourceIdx,
				});
			} else {
				existing.terminalPath = edit.filePath;
				existing.lastToolCallId = edit.toolCallId;
				existing.lastFilePath = edit.filePath;
				existing.lastKind = edit.kind;
				existing.lastSourceIdx = sourceIdx;
			}
		}
	}

	if (totalEdits === 0) {
		return [];
	}

	const results: ISessionFileDiff[] = [];
	const diffPromises: Promise<void>[] = [];

	for (const identity of identities.values()) {
		if (folderScope && !isPathWithinFolderScope(identity.terminalPath, folderScope)) {
			continue;
		}
		diffPromises.push((async () => {
			const firstSource = sources[identity.firstSourceIdx];
			const lastSource = sources[identity.lastSourceIdx];

			let beforeText: string;
			if (identity.firstKind === FileEditKind.Create) {
				beforeText = '';
			} else {
				const content = await firstSource.db.readFileEditContent(identity.firstToolCallId, identity.firstFilePath);
				beforeText = content?.beforeContent ? new TextDecoder().decode(content.beforeContent) : '';
			}

			let afterText: string;
			if (identity.lastKind === FileEditKind.Delete) {
				afterText = '';
			} else {
				const content = await lastSource.db.readFileEditContent(identity.lastToolCallId, identity.lastFilePath);
				afterText = content?.afterContent ? new TextDecoder().decode(content.afterContent) : '';
			}

			if (beforeText === afterText) {
				return;
			}

			const counts = await diffService.computeDiffCounts(beforeText, afterText);
			results.push(createSessionFileDiff(firstSource.sessionUri, lastSource.sessionUri, identity, counts.added, counts.removed));
		})());
	}

	await Promise.allSettled(diffPromises);

	return results;
}

function isPathWithinFolderScope(filePath: string, folderRoots: readonly URI[]): boolean {
	const fileUri = URI.file(filePath);
	return folderRoots.some(root => extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, root));
}

export async function computeTurnDiffs(
	sessionUri: string,
	db: ISessionDatabase,
	diffService: IDiffComputeService,
	turnId: string,
	folderScope?: readonly URI[],
): Promise<ISessionFileDiff[]> {
	const turnEdits = await db.getFileEditsByTurn(turnId);
	if (turnEdits.length === 0) {
		return [];
	}

	const pathToIdentityKey = new Map<string, string>();
	const identities = new Map<string, IFileIdentity>();
	let nextIdentitySeq = 0;
	for (const edit of turnEdits) {
		let identityKey: string;
		if (edit.kind === FileEditKind.Rename && edit.originalPath) {
			identityKey = pathToIdentityKey.get(edit.originalPath) ?? `${nextIdentitySeq++}`;
			pathToIdentityKey.set(edit.filePath, identityKey);
			pathToIdentityKey.delete(edit.originalPath);
		} else {
			identityKey = pathToIdentityKey.get(edit.filePath) ?? `${nextIdentitySeq++}`;
			pathToIdentityKey.set(edit.filePath, identityKey);
		}
		const existing = identities.get(identityKey);
		if (!existing) {
			identities.set(identityKey, {
				terminalPath: edit.filePath,
				firstToolCallId: edit.toolCallId,
				firstFilePath: edit.kind === FileEditKind.Rename && edit.originalPath ? edit.originalPath : edit.filePath,
				firstKind: edit.kind,
				firstSourceIdx: 0,
				lastToolCallId: edit.toolCallId,
				lastFilePath: edit.filePath,
				lastKind: edit.kind,
				lastSourceIdx: 0,
			});
		} else {
			existing.terminalPath = edit.filePath;
			existing.lastToolCallId = edit.toolCallId;
			existing.lastFilePath = edit.filePath;
			existing.lastKind = edit.kind;
		}
	}

	const results: ISessionFileDiff[] = [];
	const diffPromises: Promise<void>[] = [];
	for (const identity of identities.values()) {
		if (folderScope && !isPathWithinFolderScope(identity.terminalPath, folderScope)) {
			continue;
		}
		diffPromises.push((async () => {
			let beforeText: string;
			if (identity.firstKind === FileEditKind.Create) {
				beforeText = '';
			} else {
				const content = await db.readFileEditContent(identity.firstToolCallId, identity.firstFilePath);
				beforeText = content?.beforeContent ? new TextDecoder().decode(content.beforeContent) : '';
			}
			let afterText: string;
			if (identity.lastKind === FileEditKind.Delete) {
				afterText = '';
			} else {
				const content = await db.readFileEditContent(identity.lastToolCallId, identity.lastFilePath);
				afterText = content?.afterContent ? new TextDecoder().decode(content.afterContent) : '';
			}
			if (beforeText === afterText) {
				return;
			}
			const counts = await diffService.computeDiffCounts(beforeText, afterText);
			results.push(createSessionFileDiff(sessionUri, sessionUri, identity, counts.added, counts.removed));
		})());
	}
	await Promise.allSettled(diffPromises);
	return results;
}
