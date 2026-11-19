/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Result } from '../../../src/util/common/result';
import { LogDocumentId, LogEntry } from '../logRecordingTypes';
import { applyEditsToContent } from '../responseStep';

export interface ISameFileJump {
	readonly kind: 'sameFile';
	readonly fromLine: number;
	readonly toLine: number;
	readonly toOffset: number;
}

export interface ICrossFileJump {
	readonly kind: 'crossFile';
	readonly toDocLogId: LogDocumentId;
	readonly toRelativePath: string;
	readonly toLine: number;
}

export interface ISameFileDetectorOptions {
	readonly activeDocLogId: LogDocumentId;
	readonly cursorAtRequest: { readonly offset: number; readonly lineNumber: number };
	readonly minLinesAbove: number;
	readonly minLinesBelow: number;
	readonly resolveActiveDocLineAt: (entryIndex: number, offset: number) => number;
}

export function detectSameFileJump(
	recordingAfterRequest: readonly LogEntry[],
	opts: ISameFileDetectorOptions,
): Result<ISameFileJump, string> {
	if (recordingAfterRequest.length === 0) {
		return Result.error('noPostRequestActivity');
	}

	for (let i = 0; i < recordingAfterRequest.length; i++) {
		const entry = recordingAfterRequest[i];
		switch (entry.kind) {
			case 'changed': {
				if (entry.edit.length === 0) {
					break;
				}
				if (entry.id !== opts.activeDocLogId) {
					return Result.error('editsAnotherFileFirst');
				}
				const firstEdit = entry.edit[0];
				const editOffset = firstEdit[0];
				const newLine = opts.resolveActiveDocLineAt(i, editOffset);
				const fromLine = opts.cursorAtRequest.lineNumber;
				const tooFarAbove = newLine < fromLine - opts.minLinesAbove;
				const tooFarBelow = newLine > fromLine + opts.minLinesBelow;
				if (!tooFarAbove && !tooFarBelow) {
					return Result.error('jumpWithinThreshold');
				}
				return Result.ok({ kind: 'sameFile', fromLine, toLine: newLine, toOffset: editOffset });
			}
			case 'focused': {
				if (entry.id !== opts.activeDocLogId) {
					return Result.error('leftActiveDocBeforeJump');
				}
				break;
			}
		}
	}

	return Result.error('noQualifyingJump');
}

export interface ICrossFileDetectorOptions {
	readonly activeDocLogId: LogDocumentId;
	readonly idToRelativePath: ReadonlyMap<LogDocumentId, string>;
	readonly getDocContentAtRequest: (docId: LogDocumentId) => string | undefined;
}

export function detectCrossFileJump(
	recordingAfterRequest: readonly LogEntry[],
	opts: ICrossFileDetectorOptions,
): Result<ICrossFileJump, string> {
	if (recordingAfterRequest.length === 0) {
		return Result.error('noPostRequestActivity');
	}

	for (let i = 0; i < recordingAfterRequest.length; i++) {
		const entry = recordingAfterRequest[i];
		if (entry.kind !== 'changed' || entry.id === opts.activeDocLogId || entry.edit.length === 0) {
			continue;
		}

		const targetDocId = entry.id;
		const editOffset = entry.edit[0][0];

		const relPath = opts.idToRelativePath.get(targetDocId);
		if (!relPath) {
			return Result.error('crossFileTargetNotEncountered');
		}

		const targetLine = resolveCrossFileLine(
			recordingAfterRequest,
			i,
			targetDocId,
			editOffset,
			opts.getDocContentAtRequest,
		);
		if (targetLine === undefined) {
			return Result.error('crossFileTargetLineUnresolved');
		}

		return Result.ok({ kind: 'crossFile', toDocLogId: targetDocId, toRelativePath: relPath, toLine: targetLine });
	}

	return Result.error('noCrossFileEdit');
}

function resolveCrossFileLine(
	entries: readonly LogEntry[],
	selectionEntryIndex: number,
	docId: LogDocumentId,
	offset: number,
	getContentAtRequest: (docId: LogDocumentId) => string | undefined,
): number | undefined {
	let content: string | undefined = getContentAtRequest(docId);
	for (let i = 0; i < selectionEntryIndex; i++) {
		const e = entries[i];
		if (e.kind === 'setContent' && e.id === docId) {
			content = e.content;
		} else if (e.kind === 'changed' && e.id === docId && content !== undefined) {
			content = applyEditsToContent(content, e.edit);
		}
	}
	if (content === undefined) {
		return undefined;
	}
	let line = 0;
	const cap = Math.min(offset, content.length);
	for (let i = 0; i < cap; i++) {
		if (content.charCodeAt(i) === 10 ) {
			line++;
		}
	}
	return line;
}

export function normalizeRelativePathForModel(relPath: string): string {
	let p = relPath.replace(/\\/g, '/');
	while (p.startsWith('./')) {
		p = p.slice(2);
	}
	p = p.replace(/\/{2,}/g, '/');
	return p;
}
