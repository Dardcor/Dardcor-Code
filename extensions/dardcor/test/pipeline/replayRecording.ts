/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRecordingInformation, ObservableWorkspaceRecordingReplayer } from '../../src/extension/inlineEdits/common/observableWorkspaceRecordingReplayer';
import { DocumentId } from '../../src/platform/inlineEdits/common/dataTypes/documentId';
import { IObservableDocument, MutableObservableWorkspace } from '../../src/platform/inlineEdits/common/observableWorkspace';
import { LogEntry } from '../../src/platform/workspaceRecorder/common/workspaceLog';
import { ErrorUtils } from '../../src/util/common/errors';
import { Result } from '../../src/util/common/result';
import { coalesce } from '../../src/util/dardcor/base/common/arrays';
import { StringText } from '../../src/util/dardcor/editor/common/core/text/abstractText';
import { Processor } from './alternativeAction/processor';
import { IStringReplacement } from './alternativeAction/types';
import { IInputRow } from './parseInput';
import { applyEditsToContent } from './responseStep';
import type { WithRowIndex } from './withRowIndex';

export interface IProcessedRow {
	readonly originalRowIndex: number;
	readonly row: IInputRow;
	readonly replayer: ObservableWorkspaceRecordingReplayer;
	readonly workspace: MutableObservableWorkspace;
	readonly activeDocId: DocumentId;
	readonly activeDocument: IObservableDocument;
	readonly activeFilePath: string;
	readonly nextUserEdit: {
		readonly edit: readonly (readonly [start: number, endEx: number, text: string])[];
		readonly relativePath: string;
		readonly originalOpIdx: number;
	};
	readonly recordingInfo: IRecordingInformation;
	readonly recordingAfterRequest: readonly LogEntry[];
	readonly activeDocLogId: number;
	readonly idToRelativePath: ReadonlyMap<number, string>;
	readonly cursorAtRequest: { readonly offset: number; readonly lineNumber: number } | undefined;
	readonly idToContentAtRequest: ReadonlyMap<number, string>;
	readonly workspaceRecording?: IWorkspaceRecordingSampleProvenance;
}

export interface IWorkspaceRecordingSampleProvenance {
	readonly sourceFormat: 'workspace-recording';
	readonly recordingRevision: 4;
	readonly policyVersion: 1;
	readonly pivotKind: 'user-edit' | 'cursor-move';
	readonly pivotOperationIndex: number;
	readonly oracleOperationCount: number;
	readonly oracleStopReason: 'cursor-move' | 'generated-edit' | 'ambiguous-edit' | 'other-document-edit' | 'idle-gap' | 'edit-limit' | 'end-of-recording';
	readonly contextTruncated: boolean;
}

export function parseSuggestedEdit(suggestedEditStr: string): [start: number, endEx: number, text: string] | null {
	const separator = ' -> ';
	const delimiterIdx = suggestedEditStr.indexOf(separator);
	if (delimiterIdx === -1) {
		return null;
	}
	const stringifiedRange = suggestedEditStr.substring(0, delimiterIdx);
	const quotedText = suggestedEditStr.substring(delimiterIdx + separator.length);
	const match = stringifiedRange.match(/^\[(\d+), (\d+)\)$/);
	if (!match || !quotedText) {
		return null;
	}
	const start = parseInt(match[1], 10);
	const endEx = parseInt(match[2], 10);
	try {
		const text = JSON.parse(quotedText) as string;
		return [start, endEx, text];
	} catch {
		return null;
	}
}

export function processRow(row: IInputRow): Result<IProcessedRow, Error> {
	try {
		return _processRow(row);
	} catch (e: unknown) {
		return Result.error(ErrorUtils.fromUnknown(e));
	}
}

function _processRow(row: IInputRow): Result<IProcessedRow, Error> {
	const proposedEdits = coalesce([parseSuggestedEdit(row.postProcessingOutcome.suggestedEdit)]);
	const isAccepted = row.suggestionStatus === 'accepted';

	const recording = row.alternativeAction?.recording;
	const entries = recording?.entries;
	if (!recording || !entries || entries.length === 0) {
		const entryCount = entries?.length ?? 0;
		return Result.fromString(`No recording entries to process (${entryCount} entries, lang: ${row.activeDocumentLanguageId})`);
	}

	return processRecordingAtPivot({
		row,
		entries,
		requestTime: recording.requestTime,
		proposedEdits,
		isAccepted,
	});
}

interface IProcessRecordingArgs {
	readonly row: IInputRow;
	readonly entries: LogEntry[];
	readonly proposedEdits: IStringReplacement[];
	readonly isAccepted: boolean;
	readonly workspaceRecording?: IWorkspaceRecordingSampleProvenance;
}

export function processRecordingAtPivot(args: IProcessRecordingArgs & {
	readonly requestTime: number;
}): Result<IProcessedRow, Error> {
	return processRecordingAtSplit(
		args,
		() => Processor.splitRecording(args.entries, args.requestTime),
		`Could not split recording at request time`,
	);
}

export function processRecordingAtIndex(args: IProcessRecordingArgs & {
	readonly pivotEntryIndex: number;
	readonly workspaceRecording: IWorkspaceRecordingSampleProvenance;
}): Result<IProcessedRow, Error> {
	return processRecordingAtSplit(
		args,
		() => Processor.splitRecordingAtIndex(args.entries, args.pivotEntryIndex),
		`Could not split recording at entry ${args.pivotEntryIndex}`,
	);
}

function processRecordingAtSplit(
	args: IProcessRecordingArgs,
	createSplit: () => Processor.ISplitRecording | undefined,
	splitError: string,
): Result<IProcessedRow, Error> {
	try {
		const split = createSplit();
		if (!split) {
			return Result.fromString(`${splitError} (${args.entries.length} entries, lang: ${args.row.activeDocumentLanguageId})`);
		}
		return _processRecordingAtSplit(args, split);
	} catch (e: unknown) {
		return Result.error(ErrorUtils.fromUnknown(e));
	}
}

function _processRecordingAtSplit(
	args: {
		readonly row: IInputRow;
		readonly proposedEdits: IStringReplacement[];
		readonly isAccepted: boolean;
		readonly workspaceRecording?: IWorkspaceRecordingSampleProvenance;
	},
	split: Processor.ISplitRecording,
): Result<IProcessedRow, Error> {
	const scoring = Processor.createScoringFromSplit(split, args.proposedEdits, args.isAccepted);

	const recording = scoring.scoringContext.recording;

	const recordingInfo: IRecordingInformation = {
		log: recording.log,
		nextUserEdit: {
			relativePath: recording.nextUserEdit.relativePath,
			edit: recording.nextUserEdit.edit,
		},
	};

	const replayer = new ObservableWorkspaceRecordingReplayer(recordingInfo);
	try {
		const { lastDocId } = replayer.replay();

		const workspace = replayer.workspace;
		const activeDocument = workspace.getDocument(lastDocId);
		if (!activeDocument) {
			replayer.dispose();
			return Result.fromString(`Active document not found after replay: ${lastDocId}`);
		}

		const activeFilePath = scoring.edits[0]?.documentUri ?? recording.nextUserEdit?.relativePath ?? 'unknown';

		const cursorAtRequest = (() => {
			for (let i = split.recordingPriorToRequest.length - 1; i >= 0; i--) {
				const entry = split.recordingPriorToRequest[i];
				if (entry.kind === 'selectionChanged' && entry.id === split.currentFile.id && entry.selection.length > 0) {
					const offset = entry.selection[0][0];
					const content = activeDocument.value.get().value;
					const transformer = new StringText(content).getTransformer();
					const lineNumber = transformer.getPosition(Math.min(offset, content.length)).lineNumber - 1;
					return { offset, lineNumber };
				}
			}
			return undefined;
		})();

		const idToContentAtRequest = (() => {
			const map = new Map<number, string>();
			for (const entry of split.recordingPriorToRequest) {
				if (entry.kind === 'setContent') {
					map.set(entry.id, entry.content);
				} else if (entry.kind === 'changed') {
					const c = map.get(entry.id);
					if (c === undefined) {
						continue;
					}
					map.set(entry.id, applyEditsToContent(c, entry.edit));
				}
			}
			return map;
		})();

		return Result.ok({
			originalRowIndex: args.row.originalRowIndex,
			row: args.row,
			replayer,
			workspace,
			activeDocId: lastDocId,
			activeDocument,
			activeFilePath,
			nextUserEdit: recording.nextUserEdit,
			recordingInfo,
			recordingAfterRequest: split.recordingAfterRequest,
			activeDocLogId: split.currentFile.id,
			idToRelativePath: split.idToFileMap,
			cursorAtRequest,
			idToContentAtRequest,
			workspaceRecording: args.workspaceRecording,
		});
	} catch (e) {
		replayer.dispose();
		throw e;
	}
}

export function processAllRows(rows: readonly IInputRow[]): {
	processed: IProcessedRow[];
	errors: WithRowIndex<Error>[];
} {
	const processed: IProcessedRow[] = [];
	const errors: WithRowIndex<Error>[] = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		const result = processRow(row);
		if (result.isError()) {
			errors.push({ originalRowIndex: row.originalRowIndex, value: result.err });
		} else {
			processed.push(result.val);
		}
	}

	return { processed, errors };
}
