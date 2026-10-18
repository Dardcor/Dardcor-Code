/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


















function makeFixedWidthDoc(prefix: string, n: number): string {
	const lines: string[] = [];
	for (let i = 0; i < n; i++) {
		lines.push(`${prefix}${String(i).padStart(2, '0')}`);
	}
	return lines.join('\n') + '\n';
}


function lineStartOffset(lineIndex: number): number {
	return 7 * lineIndex;
}







const sameFileDoc = makeFixedWidthDoc('// A', 30);
const sameFileCursorOffset = lineStartOffset(2);
const sameFileJumpEditOffset = lineStartOffset(25);

const sameFileRecordingEntries = [
	{ kind: 'meta', data: { repoRootUri: 'file:///workspace' } },
	{ kind: 'documentEncountered', id: 0, time: 3000000, relativePath: 'src/same_file_jump.ts' },
	{ kind: 'setContent', id: 0, time: 3000001, content: sameFileDoc, v: 0 },



	{ kind: 'changed', id: 0, time: 3000002, edit: [[0, 0, '']], v: 1 },


	{ kind: 'selectionChanged', id: 0, time: 3000003, selection: [[sameFileCursorOffset, sameFileCursorOffset]] },


	{ kind: 'changed', id: 0, time: 3000005, edit: [[sameFileJumpEditOffset, sameFileJumpEditOffset, 'X']], v: 2 },
];

const sameFileAlternativeAction = {
	text: sameFileDoc,
	textLength: sameFileDoc.length,
	selection: [{ start: sameFileCursorOffset, endExclusive: sameFileCursorOffset }],
	edits: [],
	tags: [],
	recording: {
		entries: sameFileRecordingEntries,
		entriesSize: sameFileRecordingEntries.length,
		requestTime: 3000004,
	},
};

const sameFileOutcome = {
	suggestedEdit: `[${sameFileCursorOffset}, ${sameFileCursorOffset}) -> "noop"`,
	isInlineCompletion: false,
};

const sameFileRecord = {
	status: 'notAccepted',
	action: JSON.stringify(sameFileAlternativeAction),
	input: JSON.stringify([]),
	response: '',
	outcome: JSON.stringify(sameFileOutcome),
	language: 'typescript',
};







const activeDoc = makeFixedWidthDoc('// B', 10);
const targetDoc = makeFixedWidthDoc('// C', 10);
const crossFileCursorOffset = lineStartOffset(2);
const crossFileEditOffset = lineStartOffset(4);

const crossFileRecordingEntries = [
	{ kind: 'meta', data: { repoRootUri: 'file:///workspace' } },

	{ kind: 'documentEncountered', id: 0, time: 4000000, relativePath: 'src/active.ts' },
	{ kind: 'setContent', id: 0, time: 4000001, content: activeDoc, v: 0 },


	{ kind: 'documentEncountered', id: 1, time: 4000002, relativePath: 'src/target.ts' },
	{ kind: 'setContent', id: 1, time: 4000003, content: targetDoc, v: 0 },


	{ kind: 'changed', id: 0, time: 4000004, edit: [[0, 0, '']], v: 1 },

	{ kind: 'selectionChanged', id: 0, time: 4000005, selection: [[crossFileCursorOffset, crossFileCursorOffset]] },


	{ kind: 'changed', id: 1, time: 4000007, edit: [[crossFileEditOffset, crossFileEditOffset, 'Y']], v: 1 },
];

const crossFileAlternativeAction = {
	text: activeDoc,
	textLength: activeDoc.length,
	selection: [{ start: crossFileCursorOffset, endExclusive: crossFileCursorOffset }],
	edits: [],
	tags: [],
	recording: {
		entries: crossFileRecordingEntries,
		entriesSize: crossFileRecordingEntries.length,
		requestTime: 4000006,
	},
};

const crossFileOutcome = {
	suggestedEdit: `[${crossFileCursorOffset}, ${crossFileCursorOffset}) -> "noop"`,
	isInlineCompletion: false,
};

const crossFileRecord = {
	status: 'notAccepted',
	action: JSON.stringify(crossFileAlternativeAction),
	input: JSON.stringify([]),
	response: '',
	outcome: JSON.stringify(crossFileOutcome),
	language: 'typescript',
};








const withinThresholdDoc = makeFixedWidthDoc('// D', 30);
const withinThresholdCursorOffset = lineStartOffset(10);
const withinThresholdEditOffset = lineStartOffset(12);

const withinThresholdRecordingEntries = [
	{ kind: 'meta', data: { repoRootUri: 'file:///workspace' } },
	{ kind: 'documentEncountered', id: 0, time: 5000000, relativePath: 'src/within_threshold.ts' },
	{ kind: 'setContent', id: 0, time: 5000001, content: withinThresholdDoc, v: 0 },
	{ kind: 'changed', id: 0, time: 5000002, edit: [[0, 0, '']], v: 1 },
	{ kind: 'selectionChanged', id: 0, time: 5000003, selection: [[withinThresholdCursorOffset, withinThresholdCursorOffset]] },

	{ kind: 'changed', id: 0, time: 5000005, edit: [[withinThresholdEditOffset, withinThresholdEditOffset, 'Z']], v: 2 },
];

const withinThresholdAlternativeAction = {
	text: withinThresholdDoc,
	textLength: withinThresholdDoc.length,
	selection: [{ start: withinThresholdCursorOffset, endExclusive: withinThresholdCursorOffset }],
	edits: [],
	tags: [],
	recording: {
		entries: withinThresholdRecordingEntries,
		entriesSize: withinThresholdRecordingEntries.length,
		requestTime: 5000004,
	},
};

const withinThresholdOutcome = {
	suggestedEdit: `[${withinThresholdCursorOffset}, ${withinThresholdCursorOffset}) -> "noop"`,
	isInlineCompletion: false,
};

const withinThresholdRecord = {
	status: 'notAccepted',
	action: JSON.stringify(withinThresholdAlternativeAction),
	input: JSON.stringify([]),
	response: '',
	outcome: JSON.stringify(withinThresholdOutcome),
	language: 'typescript',
};





export const cursorJumpFixtures = {
	sameFile: {
		record: sameFileRecord,
		docContent: sameFileDoc,
		relativePath: 'src/same_file_jump.ts',
		fromLine: 2,
		toLine: 25,
	},
	crossFile: {
		record: crossFileRecord,
		activeDocContent: activeDoc,
		targetDocContent: targetDoc,
		activePath: 'src/active.ts',
		targetPath: 'src/target.ts',
		fromLine: 2,
		toLine: 4,
	},
	withinThreshold: {
		record: withinThresholdRecord,
		relativePath: 'src/within_threshold.ts',
	},
} as const;


export const allCursorJumpRecords = [sameFileRecord, crossFileRecord, withinThresholdRecord];
