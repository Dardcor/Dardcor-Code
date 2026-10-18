/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAlternativeAction } from '../../../src/extension/inlineEdits/node/nextEditProviderTelemetry';
import { Random } from '../../../src/platform/inlineEdits/test/node/random';
import { LogEntry } from '../../../src/platform/workspaceRecorder/common/workspaceLog';
import { ErrorUtils } from '../../../src/util/common/errors';
import { Result } from '../../../src/util/common/result';
import { PivotStrategy } from '../../base/simulationOptions';
import { IInputRow } from '../parseInput';
import { IProcessedRow, processRecordingAtPivot } from '../replayRecording';
import { IContinuousRecord } from './continuousRecord';
import { deriveSeed, selectPivots } from './pivotStrategy';
import type { WithRowIndex } from '../withRowIndex';

export const CONTINUOUS_SUGGESTION_STATUS = 'continuous';

function synthesizeRow(record: IContinuousRecord, entries: LogEntry[], pivotTime: number, languageId: string): IInputRow {
	const alternativeAction: IAlternativeAction = {
		text: undefined,
		textLength: 0,
		selection: [],
		edits: [],
		tags: [CONTINUOUS_SUGGESTION_STATUS],
		recording: {
			entries,
			entriesSize: record.value.entriesSize,
			requestTime: pivotTime,
		},
	};

	return {
		originalRowIndex: record.originalRowIndex,
		suggestionStatus: CONTINUOUS_SUGGESTION_STATUS,
		alternativeAction,
		prompt: [],
		modelResponse: '',
		postProcessingOutcome: { suggestedEdit: '', isInlineCompletion: false },
		activeDocumentLanguageId: languageId,
	};
}

export function processContinuousRecord(record: IContinuousRecord, pivotTime: number): Result<IProcessedRow, Error> {
	try {
		return _processContinuousRecord(record, pivotTime);
	} catch (e: unknown) {
		return Result.error(ErrorUtils.fromUnknown(e));
	}
}

function _processContinuousRecord(record: IContinuousRecord, pivotTime: number): Result<IProcessedRow, Error> {
	const entries = record.value.entries;
	if (!entries || entries.length === 0) {
		return Result.fromString('Continuous recording has no entries');
	}

	const result = processRecordingAtPivot({
		row: synthesizeRow(record, entries, pivotTime, ''),
		entries,
		requestTime: pivotTime,
		proposedEdits: [],
		isAccepted: false,
	});
	if (result.isError()) {
		return result;
	}

	const languageId = result.val.activeDocument.languageId.get();
	return Result.ok({
		...result.val,
		row: { ...result.val.row, activeDocumentLanguageId: languageId },
	});
}

/**
 * Process a batch of continuous recordings into processed rows.
 *
 * Each record's pivot selection is seeded from `deriveSeed(baseSeed, rowOffset +
 * record.originalRowIndex)`, so output is reproducible from `--seed` and
 * independent of how records are sharded across parallel workers.
 *
 * `rowOffset` is the global index of the first record in this chunk (0 for
 * single-process runs); it is added to each record's local index to form the
 * global record index used for seeding.
 *
 * Each returned `IProcessedRow` holds a live replayer that the caller must dispose.
 */
export function processContinuousRecords(
	records: readonly IContinuousRecord[],
	strategy: PivotStrategy,
	baseSeed: number,
	rowOffset: number,
): {
	processed: IProcessedRow[];
	errors: WithRowIndex<Error>[];
} {
	const processed: IProcessedRow[] = [];
	const errors: WithRowIndex<Error>[] = [];

	for (const record of records) {
		const entries = record.value.entries;
		if (!entries || entries.length === 0) {
			errors.push({ originalRowIndex: record.originalRowIndex, value: new Error('Continuous recording has no entries') });
			continue;
		}

		const globalRecordIndex = rowOffset + record.originalRowIndex;
		const rng = Random.create(deriveSeed(baseSeed, globalRecordIndex));

		const pivots = selectPivots(entries, strategy, rng);
		if (pivots.length === 0) {
			errors.push({ originalRowIndex: record.originalRowIndex, value: new Error(`No eligible pivot found (strategy: ${strategy}, ${entries.length} entries)`) });
			continue;
		}

		for (const pivotTime of pivots) {
			const result = processContinuousRecord(record, pivotTime);
			if (result.isError()) {
				errors.push({ originalRowIndex: record.originalRowIndex, value: result.err });
			} else {
				processed.push(result.val);
			}
		}
	}

	return { processed, errors };
}
