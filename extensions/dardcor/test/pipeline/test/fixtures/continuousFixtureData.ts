/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/























const tsDocContent =
	`export function add(a: number, b: number): number {\n` +
	`\treturn a + b;\n` +
	`}\n`;




const tsEntries = [
	{ kind: 'meta', data: { repoRootUri: 'file:///workspace' } },
	{ kind: 'documentEncountered', id: 0, time: 1000, relativePath: 'src/math.ts' },
	{ kind: 'setContent', id: 0, time: 1001, content: tsDocContent, v: 0 },

	{ kind: 'changed', id: 0, time: 1002, edit: [[tsDocContent.length, tsDocContent.length, '\n']], v: 1 },

	{ kind: 'changed', id: 0, time: 1004, edit: [[16, 19, 'sum']], v: 2 },
];

const tsRecord = {
	recording: JSON.stringify({
		entries: tsEntries,
		entriesSize: JSON.stringify(tsEntries).length,
		windowStart: 900,
		windowEnd: 1100,
		sessionId: 'sess-ts',
		sequenceNumber: 7,
	}),
};





const pyDocContent =
	`def greet(name):\n` +
	`    return f"Hello, {name}!"\n`;



const pyEntries = [
	{ kind: 'meta', data: { repoRootUri: 'file:///workspace' } },
	{ kind: 'documentEncountered', id: 0, time: 2000, relativePath: 'src/greet.py' },
	{ kind: 'setContent', id: 0, time: 2001, content: pyDocContent, v: 0 },

	{ kind: 'changed', id: 0, time: 2002, edit: [[pyDocContent.length, pyDocContent.length, '\n']], v: 1 },

	{ kind: 'changed', id: 0, time: 2004, edit: [[15, 15, ' -> str']], v: 2 },
];

const pyRecord = {
	recording: JSON.stringify({
		entries: pyEntries,
		entriesSize: JSON.stringify(pyEntries).length,
		windowStart: 1900,
		windowEnd: 2100,
		sessionId: 'sess-py',
		sequenceNumber: 8,
	}),
};








const cappedRecord = {
	recording: JSON.stringify({
		entriesSize: 250_000,
		windowStart: 2900,
		windowEnd: 3100,
		sessionId: 'sess-capped',
		sequenceNumber: 9,
	}),
};





export const continuousFixtures = {
	ts: { record: tsRecord, docContent: tsDocContent },
	py: { record: pyRecord, docContent: pyDocContent },
	capped: { record: cappedRecord },
} as const;


export const allContinuousRecords = [tsRecord, pyRecord, cappedRecord];
