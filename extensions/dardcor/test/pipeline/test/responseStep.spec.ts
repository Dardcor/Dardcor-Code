/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { describe, expect, test } from 'vitest';
import { formatAsEditWindowOnly } from '../responseStep';

function lineOffset(doc: string, line: number): number {
	let off = 0;
	for (let i = 0; i < line; i++) {
		const nl = doc.indexOf('\n', off);
		off = nl + 1;
	}
	return off;
}

describe('formatAsEditWindowOnly (xtab-275)', () => {

	const docLines = Array.from({ length: 20 }, (_, i) => `L${i}`);
	const docContent = docLines.join('\n');

	test('drops only the oracle edits that fall outside the prompt edit window', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const inWindowStart = lineOffset(docContent, 6);
		const inWindowEnd = inWindowStart + 'L6'.length;

		const outOfWindowStart = lineOffset(docContent, 15);
		const outOfWindowEnd = outOfWindowStart + 'L15'.length;

		const inWindowStart2 = lineOffset(docContent, 8);
		const inWindowEnd2 = inWindowStart2 + 'L8'.length;

		const edits: [number, number, string][] = [
			[inWindowStart, inWindowEnd, 'EDITED6'],
			[outOfWindowStart, outOfWindowEnd, 'OUTSIDE'],
			[inWindowStart2, inWindowEnd2, 'EDITED8'],
		];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'EDITED6', 'L7', 'EDITED8', 'L9'].join('\n'),
			droppedCount: 1,
		});
	});

	test('keeps all edits when every edit lies inside the window', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const edit1Start = lineOffset(docContent, 6);
		const edit1End = edit1Start + 'L6'.length;

		const edit2Start = lineOffset(docContent, 8);
		const edit2End = edit2Start + 'L8'.length;

		const edits: [number, number, string][] = [
			[edit1Start, edit1End, 'EDITED6'],
			[edit2Start, edit2End, 'EDITED8'],
		];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'EDITED6', 'L7', 'EDITED8', 'L9'].join('\n'),
			droppedCount: 0,
		});
	});

	test('grows the assistant slice when an in-window edit inserts lines', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const start = lineOffset(docContent, 6);
		const end = start + 'L6'.length;

		const edits: [number, number, string][] = [[start, end, 'A\nB']];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'A', 'B', 'L7', 'L8', 'L9'].join('\n'),
			droppedCount: 0,
		});
	});

	test('shrinks the assistant slice when an in-window edit deletes a full line', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const start = lineOffset(docContent, 6);
		const end = lineOffset(docContent, 7);

		const edits: [number, number, string][] = [[start, end, '']];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'L7', 'L8', 'L9'].join('\n'),
			droppedCount: 0,
		});
	});

	test('drops an edit that straddles the window boundary', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const start = lineOffset(docContent, 9);
		const end = lineOffset(docContent, 10) + 'L10'.length;

		const edits: [number, number, string][] = [[start, end, 'STRADDLE']];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'L6', 'L7', 'L8', 'L9'].join('\n'),
			droppedCount: 1,
		});
	});

	test('returns the unmodified window slice when every oracle edit falls outside the window', () => {
		const windowStart = 5;
		const windowLineCount = 5;

		const start = lineOffset(docContent, 15);
		const end = start + 'L15'.length;

		const edits: [number, number, string][] = [[start, end, 'OUTSIDE']];

		const result = formatAsEditWindowOnly(edits, docContent, windowStart, windowLineCount);

		expect(result).toEqual({
			assistant: ['L5', 'L6', 'L7', 'L8', 'L9'].join('\n'),
			droppedCount: 1,
		});
	});
});
