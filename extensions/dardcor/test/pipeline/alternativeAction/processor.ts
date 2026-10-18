/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Edits } from '../../../src/platform/inlineEdits/common/dataTypes/edit';
import { LogEntry } from '../../../src/platform/workspaceRecorder/common/workspaceLog';
import { StringEdit, StringReplacement } from '../../../src/util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../src/util/dardcor/editor/common/core/ranges/offsetRange';
import { ISerializedEdit } from '../logRecordingTypes';
import { IStringReplacement, NextUserEdit, Recording, Scoring, SuggestedEdit } from './types';
import { binarySearch, log } from './util';

export namespace Processor {

	export interface ISplitRecording {
		readonly currentFile: { readonly id: number; readonly relativePath: string };
		readonly recordingPriorToRequest: LogEntry[];
		readonly recordingAfterRequest: LogEntry[];
		readonly idToFileMap: ReadonlyMap<number, string>;
	}

	export function splitRecording(entries: LogEntry[], requestTime: number): ISplitRecording | undefined {
		const processedRecording = splitRecordingAtRequestTime(entries, requestTime);
		if (!processedRecording) {
			return undefined;
		}

		return resolveSplitRecording(processedRecording);
	}

	export function splitRecordingAtIndex(entries: LogEntry[], pivotEntryIndex: number): ISplitRecording | undefined {
		if (pivotEntryIndex < 0 || pivotEntryIndex >= entries.length) {
			return undefined;
		}

		return resolveSplitRecording({
			wholeRecording: entries,
			recordingPriorToRequest: entries.slice(0, pivotEntryIndex + 1),
			recordingAfterRequest: entries.slice(pivotEntryIndex + 1),
		});
	}

	function resolveSplitRecording(processedRecording: {
		wholeRecording: LogEntry[];
		recordingPriorToRequest: LogEntry[];
		recordingAfterRequest: LogEntry[];
	}): ISplitRecording | undefined {
		const { wholeRecording, recordingPriorToRequest, recordingAfterRequest } = processedRecording;
		const currentFileId = determineCurrentFileId(recordingPriorToRequest);
		if (currentFileId === undefined) {
			return undefined;
		}

		const idToFileMap = documentIndexMapping(wholeRecording);

		const currentFilePath = idToFileMap.get(currentFileId);
		if (!currentFilePath) {
			return undefined;
		}

		return {
			currentFile: { id: currentFileId, relativePath: currentFilePath },
			recordingPriorToRequest,
			recordingAfterRequest,
			idToFileMap,
		};
	}

	export function createScoring(
		entries: LogEntry[],
		requestTime: number,
		proposedEdits: IStringReplacement[],
		isAccepted: boolean,
	): Scoring.t | undefined {

		const processedRecording = splitRecordingAtRequestTime(entries, requestTime);
		if (!processedRecording) {
			log('Could not split recording at request time');
			return undefined;
		}

		const split = resolveSplitRecording(processedRecording);
		if (!split) {
			log('Could not resolve recording split');
			return undefined;
		}

		return createScoringFromSplit(split, proposedEdits, isAccepted);
	}

	export function createScoringFromSplit(
		split: ISplitRecording,
		proposedEdits: IStringReplacement[],
		isAccepted: boolean,
	): Scoring.t {
		const nextUserEdit = getNextUserEdit(split.currentFile, split.recordingPriorToRequest, split.recordingAfterRequest);

		const reconstructedRecording: Recording.t = {
			log: split.recordingPriorToRequest,
			nextUserEdit,
		};

		const nesEdits = proposedEdits.map((se): SuggestedEdit.t => ({
			documentUri: split.currentFile.relativePath,
			edit: [se],
			score: isAccepted ? 1 : 0,
			scoreCategory: 'nextEdit',
		}));

		const scoring = Scoring.create(reconstructedRecording, nesEdits);

		return scoring;
	}

	function splitRecordingAtRequestTime(entries: LogEntry[], requestTime: number): {
		wholeRecording: LogEntry[];
		recordingPriorToRequest: LogEntry[];
		recordingAfterRequest: LogEntry[];
	} | undefined {

		if (!entries || entries.length === 0) {
			return undefined;
		}

		const recordingIdxOfRequestTime = binarySearch(entries, (entry: LogEntry) => {
			if (entry.kind === 'meta') {
				return -1;
			} else {
				return entry.time - requestTime;
			}
		});

		if (recordingIdxOfRequestTime === -1) {
			log('Request time is before any recording entries');
			return undefined;
		}

		const recordingPriorToRequest = entries.slice(0, recordingIdxOfRequestTime + 1);
		const recordingAfterRequest = entries.slice(recordingIdxOfRequestTime + 1);

		return {
			wholeRecording: entries,
			recordingPriorToRequest,
			recordingAfterRequest
		};
	}

	function documentIndexMapping(recording: LogEntry[]): Map<number, string> {
		const map = new Map<number, string>();
		for (const entry of recording) {
			if (entry.kind === 'documentEncountered') {
				map.set(entry.id, entry.relativePath);
			}
		}
		return map;
	}

	function determineCurrentFileId(recording: LogEntry[]): number | undefined {
		let fileId: number | undefined;
		for (let i = recording.length - 1; i >= 0; i--) {
			const entry = recording[i];
			if ('id' in entry) {
				fileId = entry.id;
				break;
			}
		}
		return fileId;
	}

	function getNextUserEdit(currentFile: { id: number; relativePath: string }, recordingBeforeRequest: LogEntry[], recordingAfterRequest: LogEntry[]): NextUserEdit.t {

		const N_EDITS_LIMIT = 10;

		const serializedEdits: ISerializedEdit[] = [];
		for (const entry of recordingAfterRequest) {
			if (entry.kind === 'changed' && 'id' in entry && entry.id === currentFile.id) {
				serializedEdits.push(entry.edit);
			}
			if (serializedEdits.length > N_EDITS_LIMIT) {
				break;
			}
		}

		const edits = new Edits(
			StringEdit,
			serializedEdits.map(se => new StringEdit(se.map(r => new StringReplacement(new OffsetRange(r[0], r[1]), r[2]))))
		);

		return {
			edit: edits.compose().replacements.map(r => [r.replaceRange.start, r.replaceRange.endExclusive, r.newText] as const),
			relativePath: currentFile.relativePath,
			originalOpIdx: recordingBeforeRequest.length - 1
		};
	}
}
