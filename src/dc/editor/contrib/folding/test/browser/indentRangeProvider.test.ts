/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FoldingMarkers } from '../../../../common/languages/languageConfiguration.js';
import { computeRanges } from '../../browser/indentRangeProvider.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';

interface ExpectedIndentRange {
	startLineNumber: number;
	endLineNumber: number;
	parentIndex: number;
}

function assertRanges(lines: string[], expected: ExpectedIndentRange[], offside: boolean, markers?: FoldingMarkers): void {
	const model = createTextModel(lines.join('\n'));
	const actual = computeRanges(model, offside, markers);

	const actualRanges: ExpectedIndentRange[] = [];
	for (let i = 0; i < actual.length; i++) {
		actualRanges[i] = r(actual.getStartLineNumber(i), actual.getEndLineNumber(i), actual.getParentIndex(i));
	}
	assert.deepStrictEqual(actualRanges, expected);
	model.dispose();
}

function r(startLineNumber: number, endLineNumber: number, parentIndex: number, marker = false): ExpectedIndentRange {
	return { startLineNumber, endLineNumber, parentIndex };
}

suite('Indentation Folding', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('Fold one level', () => {
		const range = [
			'A',
			'  A',
			'  A',
			'  A'
		];
		assertRanges(range, [r(1, 4, -1)], true);
		assertRanges(range, [r(1, 4, -1)], false);
	});

	test('Fold two levels', () => {
		const range = [
			'A',
			'  A',
			'  A',
			'    A',
			'    A'
		];
		assertRanges(range, [r(1, 5, -1), r(3, 5, 0)], true);
		assertRanges(range, [r(1, 5, -1), r(3, 5, 0)], false);
	});

	test('Fold three levels', () => {
		const range = [
			'A',
			'  A',
			'    A',
			'      A',
			'A'
		];
		assertRanges(range, [r(1, 4, -1), r(2, 4, 0), r(3, 4, 1)], true);
		assertRanges(range, [r(1, 4, -1), r(2, 4, 0), r(3, 4, 1)], false);
	});

	test('Fold decreasing indent', () => {
		const range = [
			'    A',
			'  A',
			'A'
		];
		assertRanges(range, [], true);
		assertRanges(range, [], false);
	});

	test('Fold Java', () => {
		assertRanges([
		'class A {',
		'  void foo() {',
		'    console.log();',
		'    console.log();',
		'  }',
		'',
		'  void bar() {',
		'    console.log();',
		'  }',
		'}',
		'interface B {',
		'  void bar();',
		'}',
		], [r(1, 9, -1), r(2, 4, 0), r(7, 8, 0), r(11, 12, -1)], false);
	});

	test('Fold Javadoc', () => {
		assertRanges([
		'/**',
		' * Comment',
		' */',
		'class A {',
		'  void foo() {',
		'  }',
		'}',
		], [r(1, 3, -1), r(4, 6, -1)], false);
	});
	test('Fold Whitespace Java', () => {
		assertRanges([
		'class A {',
		'',
		'  void foo() {',
		'     ',
		'     return 0;',
		'  }',
		'      ',
		'}',
		], [r(1, 7, -1), r(3, 5, 0)], false);
	});

	test('Fold Whitespace Python', () => {
		assertRanges([
		'def a:',
		'  pass',
		'   ',
		'  def b:',
		'    pass',
		'  ',
		'      ',
		'def c: # since there was a deintent here'
		], [r(1, 5, -1), r(4, 5, 0)], true);
	});

	test('Fold Tabs', () => {
		assertRanges([
		'class A {',
		'\t\t',
		'\tvoid foo() {',
		'\t \t//hello',
		'\t    return 0;',
		'  \t}',
		'      ',
		'}',
		], [r(1, 7, -1), r(3, 5, 0)], false);
	});
});

const markers: FoldingMarkers = {
	start: /^\s*#region\b/,
	end: /^\s*#endregion\b/
};

suite('Folding with regions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('Inside region, indented', () => {
		assertRanges([
		'class A {',
		'  #region',
		'  void foo() {',
		'     ',
		'     return 0;',
		'  }',
		'  #endregion',
		'}',
		], [r(1, 7, -1), r(2, 7, 0, true), r(3, 5, 1)], false, markers);
	});
	test('Inside region, not indented', () => {
		assertRanges([
		'var x;',
		'#region',
		'void foo() {',
		'     ',
		'     return 0;',
		'  }',
		'#endregion',
		'',
		], [r(2, 7, -1, true), r(3, 6, 0)], false, markers);
	});
	test('Empty Regions', () => {
		assertRanges([
		'var x;',
		'#region',
		'#endregion',
		'#region',
		'',
		'#endregion',
		'var y;',
		], [r(2, 3, -1, true), r(4, 6, -1, true)], false, markers);
	});
	test('Nested Regions', () => {
		assertRanges([
		'var x;',
		'#region',
		'#region',
		'',
		'#endregion',
		'#endregion',
		'var y;',
		], [r(2, 6, -1, true), r(3, 5, 0, true)], false, markers);
	});
	test('Nested Regions 2', () => {
		assertRanges([
		'class A {',
		'  #region',
		'',
		'  #region',
		'',
		'  #endregion',
		'  // comment',
		'  #endregion',
		'}',
		], [r(1, 8, -1), r(2, 8, 0, true), r(4, 6, 1, true)], false, markers);
	});
	test('Incomplete Regions', () => {
		assertRanges([
		'class A {',
		'#region',
		'  // comment',
		'}',
		], [r(2, 3, -1)], false, markers);
	});
	test('Incomplete Regions 2', () => {
		assertRanges([
		'',
		'#region',
		'#region',
		'#region',
		'  // comment',
		'#endregion',
		'#endregion',
		' // hello',
		], [r(3, 7, -1, true), r(4, 6, 0, true)], false, markers);
	});
	test('Indented region before', () => {
		assertRanges([
		'if (x)',
		'  return;',
		'',
		'#region',
		'  // comment',
		'#endregion',
		], [r(1, 3, -1), r(4, 6, -1, true)], false, markers);
	});
	test('Indented region before 2', () => {
		assertRanges([
		'if (x)',
		'  log();',
		'',
		'    #region',
		'      // comment',
		'    #endregion',
		], [r(1, 6, -1), r(2, 6, 0), r(4, 6, 1, true)], false, markers);
	});
	test('Indented region in-between', () => {
		assertRanges([
		'#region',
		'  // comment',
		'  if (x)',
		'    return;',
		'',
		'#endregion',
		], [r(1, 6, -1, true), r(3, 5, 0)], false, markers);
	});
	test('Indented region after', () => {
		assertRanges([
		'#region',
		'  // comment',
		'',
		'#endregion',
		'  if (x)',
		'    return;',
		], [r(1, 4, -1, true), r(5, 6, -1)], false, markers);
	});
	test('With off-side', () => {
		assertRanges([
		'#region',
		'  ',
		'',
		'#endregion',
		'',
		], [r(1, 4, -1, true)], true, markers);
	});
	test('Nested with off-side', () => {
		assertRanges([
		'#region',
		'  ',
		'#region',
		'',
		'#endregion',
		'',
		'#endregion',
		'',
		], [r(1, 7, -1, true), r(3, 5, 0, true)], true, markers);
	});
	test('Issue 35981', () => {
		assertRanges([
		'function thisFoldsToEndOfPage() {',
		'  const variable = []',
		'    // #region',
		'    .reduce((a, b) => a,[]);',
		'}',
		'',
		'function thisFoldsProperly() {',
		'  const foo = "bar"',
		'}',
		], [r(1, 4, -1), r(2, 4, 0), r(7, 8, -1)], false, markers);
	});
	test('Misspelled Markers', () => {
		assertRanges([
		'#Region',
		'#endregion',
		'#regionsandmore',
		'#endregion',
		'#region',
		'#end region',
		'#region',
		'#endregionff',
		], [], true, markers);
	});
	test('Issue 79359', () => {
		assertRanges([
		'#region',
		'',
		'class A',
		'  foo',
		'',
		'class A',
		'  foo',
		'',
		'#endregion',
		], [r(1, 9, -1, true), r(3, 4, 0), r(6, 7, 0)], true, markers);
	});
	test('Markers with stateful flags', () => {
		assertRanges([
		'#region',
		'content',
		'#endregion',
		], [r(1, 3, -1, true)], false, {
			start: /^\s*#region\b/g,
			end: /^\s*#endregion\b/g
		});

		assertRanges([
		'#REGION',
		'content',
		'#endregion',
		], [r(1, 3, -1, true)], false, {
			start: /^\s*#region\b/gi,
			end: /^\s*#endregion\b/g
		});

		assertRanges([
		'#REGION',
		'content',
		'#ENDREGION',
		], [], false, {
			start: /^\s*#region\b/gi,
			end: /^\s*#endregion\b/g
		});

		assertRanges([
		'#REGION',
		'content',
		'#ENDREGION',
		], [], false, {
			start: /^\s*#region\b/g,
			end: /^\s*#endregion\b/gi
		});
	});
});
