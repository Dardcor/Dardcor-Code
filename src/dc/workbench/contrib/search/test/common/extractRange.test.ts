/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { extractRangeFromFilter } from '../../common/search.js';

suite('extractRangeFromFilter', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('basics', async function () {
		assert.ok(!extractRangeFromFilter(''));
		assert.ok(!extractRangeFromFilter('/some/path'));
		assert.ok(!extractRangeFromFilter('/some/path/file.txt'));

		for (const lineSep of [':', '#', '(', ':line ']) {
			for (const colSep of [':', '#', ',']) {
				const base = '/some/path/file.txt';

				let res = extractRangeFromFilter(`${base}${lineSep}20`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 1);

				res = extractRangeFromFilter(`${base}${lineSep}20${colSep}`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 1);

				res = extractRangeFromFilter(`${base}${lineSep}20${colSep}3`);
				assert.strictEqual(res?.filter, base);
				assert.strictEqual(res?.range.startLineNumber, 20);
				assert.strictEqual(res?.range.startColumn, 3);
			}
		}
	});

	test('allow space after path', async function () {
		const res = extractRangeFromFilter('/some/path/file.txt (19,20)');

		assert.strictEqual(res?.filter, '/some/path/file.txt');
		assert.strictEqual(res?.range.startLineNumber, 19);
		assert.strictEqual(res?.range.startColumn, 20);
	});

	suite('ranges', function () {
		const base = '/some/path/file.txt';
		const testSpecs = [
			{ filter: `${base}:20-40`, range: { startLineNumber: 20, startColumn: 1, endLineNumber: 40, endColumn: 1 } },
			{ filter: `${base}:20:3-40:5`, range: { startLineNumber: 20, startColumn: 3, endLineNumber: 40, endColumn: 5 } },
			{ filter: `${base}:20:3-40`, range: { startLineNumber: 20, startColumn: 3, endLineNumber: 40, endColumn: 1 } },
			{ filter: `${base}#20#3-40,5`, range: { startLineNumber: 20, startColumn: 3, endLineNumber: 40, endColumn: 5 } },
			{ filter: `${base}(20,3-40,5)`, range: { startLineNumber: 20, startColumn: 3, endLineNumber: 40, endColumn: 5 } },
			{ filter: `${base}:20-`, range: { startLineNumber: 20, startColumn: 1, endLineNumber: 20, endColumn: 1 } },
		];
		for (const { filter, range } of testSpecs) {
			test(filter, () => {
				assert.deepStrictEqual(extractRangeFromFilter(filter), { filter: base, range });
			});
		}

		test('hyphen in path is not treated as a range', () => {
			assert.ok(!extractRangeFromFilter('/some/path/my-file.txt'));
			assert.ok(!extractRangeFromFilter('/some/path/file-2.txt'));
		});
	});

	suite('unless', function () {
		const testSpecs = [
			{ filter: '/some/path/file.txt@alphasymbol', unless: ['@'], result: undefined },
			{ filter: '@/some/path/file.txt (19,20)', unless: ['@'], result: undefined },
			{ filter: '/some/path/file.txt (19,20)@', unless: ['@'], result: undefined },
			{
				filter: '/some/@path/file.txt (19,20)', unless: ['@'], result: {
					filter: '/some/@path/file.txt',
					range: {
						endColumn: 20,
						endLineNumber: 19,
						startColumn: 20,
						startLineNumber: 19
					}
				}
			},
			{
				filter: '/some/@path/file.txt:19:20', unless: ['@'], result: {
					filter: '/some/@path/file.txt',
					range: {
						endColumn: 20,
						endLineNumber: 19,
						startColumn: 20,
						startLineNumber: 19
					}
				}
			},
			{
				filter: '/some/@path/file.txt#19', unless: ['@'], result: {
					filter: '/some/@path/file.txt',
					range: {
						endColumn: 1,
						endLineNumber: 19,
						startColumn: 1,
						startLineNumber: 19
					}
				}
			},
		];
		for (const { filter, unless, result } of testSpecs) {
			test(`${filter} - ${JSON.stringify(unless)}`, () => {
				assert.deepStrictEqual(extractRangeFromFilter(filter, unless), result);
			});
		}
	});
});
