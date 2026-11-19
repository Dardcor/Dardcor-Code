/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { GlyphMarginLanesModel, } from '../../../common/viewModel/glyphLanesModel.js';
import { Range } from '../../../common/core/range.js';
import { GlyphMarginLane } from '../../../common/model.js';

suite('GlyphLanesModel', () => {
	let model: GlyphMarginLanesModel;

	ensureNoDisposablesAreLeakedInTestSuite();

	const lineRange = (startLineNumber: number, endLineNumber: number) => new Range(startLineNumber, 1, endLineNumber, 1);
	const assertLines = (fromLine: number, n: number, expected: GlyphMarginLane[][]) => {
		const result: GlyphMarginLane[][] = [];
		for (let i = 0; i < n; i++) {
			result.push(model.getLanesAtLine(fromLine + i));
		}
		assert.deepStrictEqual(result, expected, `fromLine: ${fromLine}, n: ${n}`);
	};

	setup(() => {
		model = new GlyphMarginLanesModel(10);
	});

	test('handles empty', () => {
		assert.equal(model.requiredLanes, 1);
		assertLines(1, 1, [
			[GlyphMarginLane.Center],
		]);
	});

	test('works with a single line range', () => {
		model.push(GlyphMarginLane.Left, lineRange(2, 3));
		assert.equal(model.requiredLanes, 1);
		assertLines(1, 5, [
			[GlyphMarginLane.Center],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Center],
			[GlyphMarginLane.Center],
		]);
	});

	test('persists ranges', () => {
		model.push(GlyphMarginLane.Left, lineRange(2, 3), true);
		assert.equal(model.requiredLanes, 1);
		assertLines(1, 5, [
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Left],
		]);
	});

	test('handles overlaps', () => {
		model.push(GlyphMarginLane.Left, lineRange(6, 9));
		model.push(GlyphMarginLane.Right, lineRange(5, 7));
		model.push(GlyphMarginLane.Center, lineRange(7, 8));
		assert.equal(model.requiredLanes, 3);
		assertLines(5, 6, [
			[GlyphMarginLane.Right],
			[GlyphMarginLane.Left, GlyphMarginLane.Right],
			[GlyphMarginLane.Left, GlyphMarginLane.Center, GlyphMarginLane.Right],
			[GlyphMarginLane.Left, GlyphMarginLane.Center],
			[GlyphMarginLane.Left],
			[GlyphMarginLane.Center],
		]);
	});
});
