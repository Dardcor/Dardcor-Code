/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { LogEntry } from '../../src/platform/workspaceRecorder/common/workspaceLog';
import { IInputRow } from './parseInput';
import { processAllRows } from './replayRecording';

const doc = `const a = 1;\nconst b = 2;\n`;

function makeRow(originalRowIndex: number, oracleEdit: [number, number, string][]): IInputRow {
	const entries: LogEntry[] = [
		{ kind: 'meta', data: { repoRootUri: 'file:///ws' } },
		{ kind: 'documentEncountered', id: 0, time: 1000, relativePath: 'src/a.ts' },
		{ kind: 'setContent', id: 0, time: 1001, content: doc, v: 0 },
		{ kind: 'changed', id: 0, time: 1002, edit: [[0, 0, '']], v: 1 },
		{ kind: 'changed', id: 0, time: 1004, edit: oracleEdit, v: 2 },
	];
	return {
		originalRowIndex,
		suggestionStatus: 'accepted',
		alternativeAction: {
			text: doc,
			textLength: doc.length,
			selection: [],
			edits: [],
			tags: [],
			recording: { entries, entriesSize: entries.length, requestTime: 1003 },
		},
		prompt: [],
		modelResponse: '',
		postProcessingOutcome: { suggestedEdit: '', isInlineCompletion: false },
		activeDocumentLanguageId: 'typescript',
	};
}

describe('processAllRows', () => {
	it('labels replay errors with the row\'s originalRowIndex, not its filtered array position', () => {
		const rows = [
			makeRow(0, [[6, 7, 'x']]),
			makeRow(3, [[0, 4, 'X'], [2, 6, 'Y']]),
			makeRow(5, [[6, 7, 'y']]),
		];

		const { processed, errors } = processAllRows(rows);
		try {
			expect(processed.map(p => p.originalRowIndex)).toEqual([0, 5]);
			expect(errors.map(e => ({ originalRowIndex: e.originalRowIndex, isError: e.value instanceof Error }))).toEqual([
				{ originalRowIndex: 3, isError: true },
			]);
		} finally {
			processed.forEach(p => p.replayer.dispose());
		}
	});
});
