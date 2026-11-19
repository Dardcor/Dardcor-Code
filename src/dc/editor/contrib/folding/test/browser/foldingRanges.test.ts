/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FoldingMarkers } from '../../../../common/languages/languageConfiguration.js';
import { MAX_FOLDING_REGIONS, FoldRange, FoldingRegions, FoldSource } from '../../browser/foldingRanges.js';
import { RangesCollector, computeRanges } from '../../browser/indentRangeProvider.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';

const markers: FoldingMarkers = {
	start: /^#region$/,
	end: /^#endregion$/
};

suite('FoldingRanges', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const foldRange = (from: number, to: number, collapsed: boolean | undefined = undefined, source: FoldSource = FoldSource.provider, type: string | undefined = undefined) =>
		<FoldRange>{
			startLineNumber: from,
			endLineNumber: to,
			type: type,
			isCollapsed: collapsed || false,
			source
		};
	const assertEqualRanges = (range1: FoldRange, range2: FoldRange, msg: string) => {
		assert.strictEqual(range1.startLineNumber, range2.startLineNumber, msg + ' start');
		assert.strictEqual(range1.endLineNumber, range2.endLineNumber, msg + ' end');
		assert.strictEqual(range1.type, range2.type, msg + ' type');
		assert.strictEqual(range1.isCollapsed, range2.isCollapsed, msg + ' collapsed');
		assert.strictEqual(range1.source, range2.source, msg + ' source');
	};

	test('test max folding regions', () => {
		const lines: string[] = [];
		const nRegions = MAX_FOLDING_REGIONS;
		const collector = new RangesCollector({ limit: MAX_FOLDING_REGIONS, update: () => { } });
		for (let i = 0; i < nRegions; i++) {
			const startLineNumber = lines.length;
			lines.push('#region');
			const endLineNumber = lines.length;
			lines.push('#endregion');
			collector.insertFirst(startLineNumber, endLineNumber, 0);
		}
		const model = createTextModel(lines.join('\n'));
		const actual = collector.toIndentRanges(model);
		assert.strictEqual(actual.length, nRegions, 'len');
		model.dispose();

	});

	test('findRange', () => {
		const lines = [
		'#region',
		'#endregion',
		'class A {',
		'  void foo() {',
		'    if (true) {',
		'        return;',
		'    }',
		'',
		'    if (true) {',
		'      return;',
		'    }',
		'  }',
		'}'];

		const textModel = createTextModel(lines.join('\n'));
		try {
			const actual = computeRanges(textModel, false, markers);

			assert.strictEqual(actual.findRange(1), 0, '1');
			assert.strictEqual(actual.findRange(2), 0, '2');
			assert.strictEqual(actual.findRange(3), 1, '3');
			assert.strictEqual(actual.findRange(4), 2, '4');
			assert.strictEqual(actual.findRange(5), 3, '5');
			assert.strictEqual(actual.findRange(6), 3, '6');
			assert.strictEqual(actual.findRange(7), 2, '7');
			assert.strictEqual(actual.findRange(8), 2, '8');
			assert.strictEqual(actual.findRange(9), 4, '9');
			assert.strictEqual(actual.findRange(10), 4, '10');
			assert.strictEqual(actual.findRange(11), 2, '11');
			assert.strictEqual(actual.findRange(12), 1, '12');
			assert.strictEqual(actual.findRange(13), -1, '13');
		} finally {
			textModel.dispose();
		}


	});

	test('setCollapsed', () => {
		const lines: string[] = [];
		const nRegions = 500;
		for (let i = 0; i < nRegions; i++) {
			lines.push('#region');
		}
		for (let i = 0; i < nRegions; i++) {
			lines.push('#endregion');
		}
		const model = createTextModel(lines.join('\n'));
		const actual = computeRanges(model, false, markers);
		assert.strictEqual(actual.length, nRegions, 'len');
		for (let i = 0; i < nRegions; i++) {
			actual.setCollapsed(i, i % 3 === 0);
		}
		for (let i = 0; i < nRegions; i++) {
			assert.strictEqual(actual.isCollapsed(i), i % 3 === 0, 'line' + i);
		}
		model.dispose();
	});

	test('sanitizeAndMerge1', () => {
		const regionSet1: FoldRange[] = [
			foldRange(0, 100),
			foldRange(1, 100, false, FoldSource.provider, 'A'),
			foldRange(1, 100, false, FoldSource.provider, 'Z'),
			foldRange(10, 10, false),
			foldRange(20, 80, false, FoldSource.provider, 'C1'),
			foldRange(22, 80, true, FoldSource.provider, 'D1'),
			foldRange(90, 101),
		];
		const regionSet2: FoldRange[] = [
			foldRange(20, 80, true),
			foldRange(18, 80, true),
			foldRange(21, 81, true, FoldSource.provider, 'Z'),
			foldRange(22, 80, true, FoldSource.provider, 'D2'),
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 3, 'result length1');
		assertEqualRanges(result[0], foldRange(1, 100, false, FoldSource.provider, 'A'), 'A1');
		assertEqualRanges(result[1], foldRange(20, 80, true, FoldSource.provider, 'C1'), 'C1');
		assertEqualRanges(result[2], foldRange(22, 80, true, FoldSource.provider, 'D1'), 'D1');
	});

	test('sanitizeAndMerge2', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, FoldSource.provider, 'a1'),
			foldRange(2, 100, false, FoldSource.provider, 'a2'),
			foldRange(3, 19, false, FoldSource.provider, 'a3'),
			foldRange(20, 71, false, FoldSource.provider, 'a4'),
			foldRange(21, 29, false, FoldSource.provider, 'a5'),
			foldRange(81, 91, false, FoldSource.provider, 'a6'),
		];
		const regionSet2: FoldRange[] = [
			foldRange(30, 39, true, FoldSource.provider, 'b1'),
			foldRange(40, 49, true, FoldSource.userDefined, 'b2'),
			foldRange(50, 100, true, FoldSource.userDefined, 'b3'),
			foldRange(80, 90, true, FoldSource.userDefined, 'b4'),
			foldRange(92, 100, true, FoldSource.userDefined, 'b5'),
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 9, 'result length1');
		assertEqualRanges(result[0], foldRange(1, 100, false, FoldSource.provider, 'a1'), 'P1');
		assertEqualRanges(result[1], foldRange(2, 100, false, FoldSource.provider, 'a2'), 'P2');
		assertEqualRanges(result[2], foldRange(3, 19, false, FoldSource.provider, 'a3'), 'P3');
		assertEqualRanges(result[3], foldRange(21, 29, false, FoldSource.provider, 'a5'), 'P4');
		assertEqualRanges(result[4], foldRange(30, 39, true, FoldSource.recovered, 'b1'), 'P5');
		assertEqualRanges(result[5], foldRange(40, 49, true, FoldSource.userDefined, 'b2'), 'P6');
		assertEqualRanges(result[6], foldRange(50, 100, true, FoldSource.userDefined, 'b3'), 'P7');
		assertEqualRanges(result[7], foldRange(80, 90, true, FoldSource.userDefined, 'b4'), 'P8');
		assertEqualRanges(result[8], foldRange(92, 100, true, FoldSource.userDefined, 'b5'), 'P9');
	});

	test('sanitizeAndMerge3', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, FoldSource.provider, 'a1'),
			foldRange(10, 29, false, FoldSource.provider, 'a2'),
			foldRange(35, 39, true, FoldSource.recovered, 'a3'),
		];
		const regionSet2: FoldRange[] = [
			foldRange(10, 29, true, FoldSource.recovered, 'b1'),
			foldRange(20, 28, true, FoldSource.provider, 'b2'),
			foldRange(30, 39, true, FoldSource.recovered, 'b3'),
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 5, 'result length3');
		assertEqualRanges(result[0], foldRange(1, 100, false, FoldSource.provider, 'a1'), 'R1');
		assertEqualRanges(result[1], foldRange(10, 29, true, FoldSource.provider, 'a2'), 'R2');
		assertEqualRanges(result[2], foldRange(20, 28, true, FoldSource.recovered, 'b2'), 'R3');
		assertEqualRanges(result[3], foldRange(30, 39, true, FoldSource.recovered, 'b3'), 'R3');
		assertEqualRanges(result[4], foldRange(35, 39, true, FoldSource.recovered, 'a3'), 'R4');
	});

	test('sanitizeAndMerge4', () => {
		const regionSet1: FoldRange[] = [
			foldRange(1, 100, false, FoldSource.provider, 'a1'),
		];
		const regionSet2: FoldRange[] = [
			foldRange(20, 28, true, FoldSource.provider, 'b1'),
			foldRange(30, 38, true, FoldSource.provider, 'b2'),
		];
		const result = FoldingRegions.sanitizeAndMerge(regionSet1, regionSet2, 100);
		assert.strictEqual(result.length, 3, 'result length4');
		assertEqualRanges(result[0], foldRange(1, 100, false, FoldSource.provider, 'a1'), 'R1');
		assertEqualRanges(result[1], foldRange(20, 28, true, FoldSource.recovered, 'b1'), 'R2');
		assertEqualRanges(result[2], foldRange(30, 38, true, FoldSource.recovered, 'b2'), 'R3');
	});

});
