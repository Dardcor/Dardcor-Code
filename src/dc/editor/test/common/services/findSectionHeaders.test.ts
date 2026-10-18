/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { FindSectionHeaderOptions, ISectionHeaderFinderTarget, findSectionHeaders } from '../../../common/services/findSectionHeaders.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

class TestSectionHeaderFinderTarget implements ISectionHeaderFinderTarget {
	constructor(private readonly lines: string[]) { }

	getLineCount(): number {
		return this.lines.length;
	}

	getLineContent(lineNumber: number): string {
		return this.lines[lineNumber - 1];
	}
}

suite('FindSectionHeaders', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('finds simple section headers', () => {
		const model = new TestSectionHeaderFinderTarget([
			'regular line',
			'MARK: My Section',
			'another line',
			'MARK: Another Section',
			'last line'
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: 'MARK:\\s*(?<label>.*)$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'My Section');
		assert.strictEqual(headers[0].range.startLineNumber, 2);
		assert.strictEqual(headers[0].range.endLineNumber, 2);

		assert.strictEqual(headers[1].text, 'Another Section');
		assert.strictEqual(headers[1].range.startLineNumber, 4);
		assert.strictEqual(headers[1].range.endLineNumber, 4);
	});

	test('finds section headers with separators', () => {
		const model = new TestSectionHeaderFinderTarget([
			'regular line',
			'MARK: -My Section',
			'another line',
			'MARK: - Another Section',
			'last line'
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: 'MARK:\\s*(?<separator>-?)\\s*(?<label>.*)$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'My Section');
		assert.strictEqual(headers[0].hasSeparatorLine, true);

		assert.strictEqual(headers[1].text, 'Another Section');
		assert.strictEqual(headers[1].hasSeparatorLine, true);
	});

	test('finds multi-line section headers with separators', () => {
		const model = new TestSectionHeaderFinderTarget([
			'regular line',
			'// ==========',
			'// My Section',
			'// ==========',
			'code...',
			'// ==========',
			'// Another Section',
			'// ==========',
			'more code...'
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'My Section');
		assert.strictEqual(headers[0].range.startLineNumber, 2);
		assert.strictEqual(headers[0].range.endLineNumber, 4);

		assert.strictEqual(headers[1].text, 'Another Section');
		assert.strictEqual(headers[1].range.startLineNumber, 6);
		assert.strictEqual(headers[1].range.endLineNumber, 8);
	});

	test('handles overlapping multi-line section headers correctly', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==========',
			'// Section 1',
			'// ==========',
			'// ==========',
			'// Section 2',
			'// ==========',
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[0].range.startLineNumber, 1);
		assert.strictEqual(headers[0].range.endLineNumber, 3);

		assert.strictEqual(headers[1].text, 'Section 2');
		assert.strictEqual(headers[1].range.startLineNumber, 4);
		assert.strictEqual(headers[1].range.endLineNumber, 6);
	});

	test('section headers must be in comments when specified', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==========',
			'// Section 1',
			'// ==========',
			'==========',
			'Section 2',
			'=========='
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^(?:\/\/ )?=+\\n^(?:\/\/ )?(?<label>[^\\n]+?)\\n^(?:\/\/ )?=+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers[0].shouldBeInComments, true);
	});

	test('handles section headers at chunk boundaries', () => {
		const lines: string[] = [];
		for (let i = 0; i < 150; i++) {
			lines.push('line ' + i);
		}

		lines[97] = '// ==========';
		lines[98] = '// Section 1';
		lines[99] = '// ==========';
		lines[100] = '// ==========';
		lines[101] = '// Section 2';
		lines[102] = '// ==========';

		const model = new TestSectionHeaderFinderTarget(lines);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[0].range.startLineNumber, 98);
		assert.strictEqual(headers[0].range.endLineNumber, 100);

		assert.strictEqual(headers[1].text, 'Section 2');
		assert.strictEqual(headers[1].range.startLineNumber, 101);
		assert.strictEqual(headers[1].range.endLineNumber, 103);
	});

	test('handles empty regex gracefully without infinite loop', () => {
		const model = new TestSectionHeaderFinderTarget([
			'line 1',
			'line 2',
			'line 3'
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: ''
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 0, 'Should return no headers for empty regex');
	});

	test('handles whitespace-only regex gracefully without infinite loop', () => {
		const model = new TestSectionHeaderFinderTarget([
			'line 1',
			'line 2',
			'line 3'
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '   '
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 0, 'Should return no headers for whitespace-only regex');
	});

	test('correctly advances past matches without infinite loop', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==========',
			'// Section 1',
			'// ==========',
			'some code',
			'// ==========',
			'// Section 2',
			'// ==========',
			'more code',
			'// ==========',
			'// Section 3',
			'// ==========',
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 3, 'Should find all three section headers');
		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[1].text, 'Section 2');
		assert.strictEqual(headers[2].text, 'Section 3');
	});

	test('handles consecutive section headers correctly', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==========',
			'// Section 1',
			'// ==========',
			'// ==========',
			'// Section 2',
			'// ==========',
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2, 'Should find both section headers');
		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[1].text, 'Section 2');
	});

	test('handles nested separators correctly', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==============',
			'// Major Section',
			'// ==============',
			'',
			'// ----------',
			'// Subsection',
			'// ----------',
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ [-=]+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ [-=]+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2, 'Should find both section headers');
		assert.strictEqual(headers[0].text, 'Major Section');
		assert.strictEqual(headers[1].text, 'Subsection');
	});

	test('handles section headers at chunk boundaries correctly', () => {
		const lines: string[] = [];
		for (let i = 0; i < 97; i++) {
			lines.push(`line ${i}`);
		}

		lines.push('// ==========');
		lines.push('// Section 1');
		lines.push('// ==========');
		lines.push('// ==========');
		lines.push('// Section 2');
		lines.push('// ==========');

		for (let i = 103; i < 150; i++) {
			lines.push(`line ${i}`);
		}

		const model = new TestSectionHeaderFinderTarget(lines);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2, 'Should find both section headers across chunk boundary');

		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[0].range.startLineNumber, 98);
		assert.strictEqual(headers[0].range.endLineNumber, 100);

		assert.strictEqual(headers[1].text, 'Section 2');
		assert.strictEqual(headers[1].range.startLineNumber, 101);
		assert.strictEqual(headers[1].range.endLineNumber, 103);
	});

	test('handles overlapping section headers without duplicates', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ==========',
			'// Section 1',
			'// ==========',
			'// Section 2',
			'// ==========',
			'// ==========',
			'// Section 3',
			'// ==========='
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ =+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ =+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 2);

		assert.strictEqual(headers[0].text, 'Section 1');
		assert.strictEqual(headers[0].range.startLineNumber, 1);
		assert.strictEqual(headers[0].range.endLineNumber, 3);


		assert.strictEqual(headers[1].text, 'Section 3');
		assert.strictEqual(headers[1].range.startLineNumber, 6);
		assert.strictEqual(headers[1].range.endLineNumber, 8);
	});

	test('handles partially overlapping multiline section headers correctly', () => {
		const model = new TestSectionHeaderFinderTarget([
			'// ================',
			'// Major Section 1',
			'// ================',
			'// --------',
			'// Subsection 1.1',
			'// --------',
			'// ================',
			'// Major Section 2',
			'// ================',
		]);

		const options: FindSectionHeaderOptions = {
			findRegionSectionHeaders: false,
			findMarkSectionHeaders: true,
			markSectionHeaderRegex: '^\/\/ [-=]+\\n^\/\/ (?<label>[^\\n]+?)\\n^\/\/ [-=]+$'
		};

		const headers = findSectionHeaders(model, options);
		assert.strictEqual(headers.length, 3);

		assert.strictEqual(headers[0].text, 'Major Section 1');
		assert.strictEqual(headers[0].range.startLineNumber, 1);
		assert.strictEqual(headers[0].range.endLineNumber, 3);

		assert.strictEqual(headers[1].text, 'Subsection 1.1');
		assert.strictEqual(headers[1].range.startLineNumber, 4);
		assert.strictEqual(headers[1].range.endLineNumber, 6);

		assert.strictEqual(headers[2].text, 'Major Section 2');
		assert.strictEqual(headers[2].range.startLineNumber, 7);
		assert.strictEqual(headers[2].range.endLineNumber, 9);
	});
});
