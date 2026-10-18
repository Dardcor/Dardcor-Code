/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IContinuousRecording } from '../../../src/extension/inlineEdits/node/continuousEnhancedTelemetrySender';
import { ErrorUtils } from '../../../src/util/common/errors';
import type { WithRowIndex } from '../withRowIndex';
import { streamJsonRecords } from '../streamJsonRecords';

export type IContinuousRecord = WithRowIndex<IContinuousRecording>;

const RECORDING_KEY = 'recording';

export function parseContinuousRecord(record: Record<string, unknown>, rowIndex: number): IContinuousRecord {
	const raw = record[RECORDING_KEY];
	if (raw === undefined || raw === null) {
		throw new Error(`Missing key: ${RECORDING_KEY}`);
	}

	let recording: IContinuousRecording;
	if (typeof raw === 'string') {
		recording = JSON.parse(raw) as IContinuousRecording;
	} else if (typeof raw === 'object') {
		recording = raw as IContinuousRecording;
	} else {
		throw new Error(`'${RECORDING_KEY}' must be a JSON string or object, got ${typeof raw}`);
	}

	if (!recording.entries || recording.entries.length === 0) {
		throw new Error(`recording.entries is missing or empty (entriesSize: ${recording.entriesSize ?? '?'})`);
	}

	return {
		originalRowIndex: rowIndex,
		value: recording,
	};
}

export async function loadAndParseContinuousInput(inputPath: string, verbose = false): Promise<{
	records: IContinuousRecord[];
	errors: WithRowIndex<Error>[];
}> {
	const records: IContinuousRecord[] = [];
	const errors: WithRowIndex<Error>[] = [];

	let i = 0;
	for await (const record of streamJsonRecords<Record<string, unknown>>(inputPath)) {
		const rowIndex = i++;
		try {
			records.push(parseContinuousRecord(record, rowIndex));
		} catch (e) {
			errors.push({ originalRowIndex: rowIndex, value: ErrorUtils.fromUnknown(e) });
		}
	}

	if (verbose) {
		console.log(`Read ${i} continuous records from ${inputPath}`);
	}

	return { records, errors };
}
