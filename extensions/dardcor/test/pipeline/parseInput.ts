/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAlternativeAction } from '../../src/extension/inlineEdits/node/nextEditProviderTelemetry';
import { ErrorUtils } from '../../src/util/common/errors';
import { streamJsonRecords } from './streamJsonRecords';
import type { WithRowIndex } from './withRowIndex';

export interface IInputRow {
	readonly originalRowIndex: number;
	readonly suggestionStatus: string;
	readonly alternativeAction: IAlternativeAction;
	readonly prompt: unknown[];
	readonly modelResponse: string;
	readonly postProcessingOutcome: {
		suggestedEdit: string;
		isInlineCompletion: boolean;
	};
	readonly activeDocumentLanguageId: string;
}

const requiredKeys = [
	'status',
	'action',
	'input',
	'response',
	'outcome',
	'language',
] as const;

function parseInputRecord(record: Record<string, string>, rowIndex: number): IInputRow {
	for (const key of requiredKeys) {
		if (!(key in record)) {
			throw new Error(`Missing key: ${key}`);
		}
	}

	const alternativeAction = JSON.parse(record['action']) as IAlternativeAction;
	const prompt = JSON.parse(record['input']) as unknown[];
	const postProcessingOutcome = JSON.parse(record['outcome']) as {
		suggestedEdit: string;
		isInlineCompletion: boolean;
	};

	if (!alternativeAction.recording) {
		throw new Error('action.recording is missing');
	}
	if (!alternativeAction.recording.entries || alternativeAction.recording.entries.length === 0) {
		throw new Error('action.recording.entries is empty');
	}
	if (!postProcessingOutcome.suggestedEdit) {
		throw new Error('outcome.suggestedEdit is missing');
	}

	return {
		originalRowIndex: rowIndex,
		suggestionStatus: record['status'],
		alternativeAction,
		prompt,
		modelResponse: record['response'],
		postProcessingOutcome,
		activeDocumentLanguageId: record['language'],
	};
}

export async function loadAndParseInput(inputPath: string, verbose = false): Promise<{
	rows: IInputRow[];
	errors: WithRowIndex<Error>[];
}> {
	const rows: IInputRow[] = [];
	const errors: WithRowIndex<Error>[] = [];

	let i = 0;
	for await (const record of streamJsonRecords<Record<string, string>>(inputPath)) {
		const rowIndex = i++;
		try {
			rows.push(parseInputRecord(record, rowIndex));
		} catch (e) {
			errors.push({
				originalRowIndex: rowIndex,
				value: ErrorUtils.fromUnknown(e),
			});
		}
	}

	if (verbose) {
		console.log(`Read ${i} records from ${inputPath}`);
	}

	return { rows, errors };
}
