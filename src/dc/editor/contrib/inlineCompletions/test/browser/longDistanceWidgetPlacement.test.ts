/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Size2D } from '../../../../common/core/2d/size.js';
import { LineRange } from '../../../../common/core/ranges/lineRange.js';
import { WidgetLayoutConstants, WidgetPlacementContext, ContinuousLineSizes } from '../../browser/view/inlineEdits/inlineEditsViews/longDistanceHint/longDistnaceWidgetPlacement.js';

suite('WidgetPlacementContext', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function createLineRangeInfo(startLine: number, sizes: Size2D[], top: number = 0): ContinuousLineSizes {
		return {
			lineRange: LineRange.ofLength(startLine, sizes.length),
			top,
			sizes,
		};
	}

	const defaultLayoutConstants: WidgetLayoutConstants = {
		previewEditorMargin: 5,
		widgetPadding: 2,
		widgetBorder: 1,
		lowerBarHeight: 10,
		minWidgetWidth: 50,
	};

	suite('constructor - availableSpaceSizes computation', () => {
		test('computes available space sizes correctly with no padding', () => {
			const sizes = [new Size2D(100, 20), new Size2D(150, 20), new Size2D(80, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);
			const editorTrueContentWidth = 500;
			const endOfLinePadding = () => 0;

			const context = new WidgetPlacementContext(lineRangeInfo, editorTrueContentWidth, endOfLinePadding);

			assert.strictEqual(context.availableSpaceSizes.length, 3);
			assert.strictEqual(context.availableSpaceSizes[0].width, 400);
			assert.strictEqual(context.availableSpaceSizes[1].width, 350);
			assert.strictEqual(context.availableSpaceSizes[2].width, 420);
		});

		test('computes available space sizes with end of line padding', () => {
			const sizes = [new Size2D(100, 20), new Size2D(150, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);
			const editorTrueContentWidth = 500;
			const endOfLinePadding = (lineNumber: number) => lineNumber * 10;

			const context = new WidgetPlacementContext(lineRangeInfo, editorTrueContentWidth, endOfLinePadding);

			assert.strictEqual(context.availableSpaceSizes[0].width, 390);
			assert.strictEqual(context.availableSpaceSizes[1].width, 330);
		});

		test('available space width is never negative', () => {
			const sizes = [new Size2D(600, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);
			const editorTrueContentWidth = 500;
			const endOfLinePadding = () => 0;

			const context = new WidgetPlacementContext(lineRangeInfo, editorTrueContentWidth, endOfLinePadding);

			assert.strictEqual(context.availableSpaceSizes[0].width, 0);
		});

		test('preserves heights in available space sizes', () => {
			const sizes = [new Size2D(100, 25), new Size2D(100, 30), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);
			const editorTrueContentWidth = 500;
			const endOfLinePadding = () => 0;

			const context = new WidgetPlacementContext(lineRangeInfo, editorTrueContentWidth, endOfLinePadding);

			assert.strictEqual(context.availableSpaceSizes[0].height, 25);
			assert.strictEqual(context.availableSpaceSizes[1].height, 30);
			assert.strictEqual(context.availableSpaceSizes[2].height, 20);
		});
	});

	suite('constructor - prefix sums computation', () => {
		test('computes height prefix sums correctly', () => {
			const sizes = [new Size2D(100, 20), new Size2D(100, 30), new Size2D(100, 25)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.deepStrictEqual(context.availableSpaceHeightPrefixSums, [0, 20, 50, 75]);
		});

		test('prefix sums start with 0 and have length = sizes.length + 1', () => {
			const sizes = [new Size2D(100, 10), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.strictEqual(context.availableSpaceHeightPrefixSums[0], 0);
			assert.strictEqual(context.availableSpaceHeightPrefixSums.length, 3);
		});
	});

	suite('constructor - transposed sizes', () => {
		test('transposes width and height correctly', () => {
			const sizes = [new Size2D(100, 20), new Size2D(150, 30)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.strictEqual(context.availableSpaceSizesTransposed[0].width, 20);
			assert.strictEqual(context.availableSpaceSizesTransposed[0].height, 400);
			assert.strictEqual(context.availableSpaceSizesTransposed[1].width, 30);
			assert.strictEqual(context.availableSpaceSizesTransposed[1].height, 350);
		});
	});

	suite('getWidgetVerticalOutline', () => {
		test('computes vertical outline for first line', () => {
			const sizes = [new Size2D(100, 20), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 100);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const outline = context.getWidgetVerticalOutline(1, 50, defaultLayoutConstants);

			assert.strictEqual(outline.start, 92);
			assert.strictEqual(outline.endExclusive, 168);
		});

		test('computes vertical outline for second line', () => {
			const sizes = [new Size2D(100, 20), new Size2D(100, 25)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 100);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const outline = context.getWidgetVerticalOutline(2, 50, defaultLayoutConstants);

			assert.strictEqual(outline.start, 112);
			assert.strictEqual(outline.endExclusive, 188);
		});

		test('works with zero margins', () => {
			const sizes = [new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 0);
			const zeroConstants: WidgetLayoutConstants = {
				previewEditorMargin: 0,
				widgetPadding: 0,
				widgetBorder: 0,
				lowerBarHeight: 0,
				minWidgetWidth: 50,
			};

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const outline = context.getWidgetVerticalOutline(1, 50, zeroConstants);

			assert.strictEqual(outline.start, 0);
			assert.strictEqual(outline.endExclusive, 50);
		});
	});

	suite('tryFindWidgetOutline', () => {
		test('returns undefined when no line has enough width', () => {
			const sizes = [new Size2D(460, 20), new Size2D(470, 20), new Size2D(480, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const result = context.tryFindWidgetOutline(2, 15, 500, defaultLayoutConstants);

			assert.strictEqual(result, undefined);
		});

		test('finds widget outline on target line when it has enough space', () => {
			const sizes = [new Size2D(100, 20), new Size2D(100, 20), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 0);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const result = context.tryFindWidgetOutline(2, 15, 500, defaultLayoutConstants);

			assert.ok(result !== undefined);
			assert.ok(result.horizontalWidgetRange.length >= defaultLayoutConstants.minWidgetWidth);
		});

		test('searches outward from target line', () => {
			const sizes = [
				new Size2D(100, 20),
				new Size2D(460, 20),
				new Size2D(460, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
			];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 0);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const result = context.tryFindWidgetOutline(3, 15, 500, defaultLayoutConstants);

			assert.ok(result !== undefined);
		});

		test('prefers closer lines to target', () => {
			const sizes = [
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(500, 9999),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
				new Size2D(100, 20),
			];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 0);

			for (let targetLine = 0; targetLine <= 4; targetLine++) {
				const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
				const result = context.tryFindWidgetOutline(targetLine, 15, 500, defaultLayoutConstants);
				assert.ok(result !== undefined);
				assert.ok(result.verticalWidgetRange.endExclusive < 9999);
			}

			for (let targetLine = 5; targetLine <= 10 ; targetLine++) {
				const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
				const result = context.tryFindWidgetOutline(targetLine, 15, 500, defaultLayoutConstants);
				assert.ok(result !== undefined);
				assert.ok(result.verticalWidgetRange.start > 9999);
			}
		});

		test('horizontal widget range ends at editor content right', () => {
			const sizes = [new Size2D(100, 20), new Size2D(100, 20), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 0);
			const editorTrueContentRight = 500;

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);
			const result = context.tryFindWidgetOutline(2, 15, editorTrueContentRight, defaultLayoutConstants);

			assert.ok(result !== undefined);
			assert.strictEqual(result.horizontalWidgetRange.endExclusive, editorTrueContentRight);
		});
	});

	suite('edge cases', () => {
		test('handles single line range', () => {
			const sizes = [new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(5, sizes, 50);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.strictEqual(context.availableSpaceSizes.length, 1);
			assert.deepStrictEqual(context.availableSpaceHeightPrefixSums, [0, 20]);
		});

		test('handles empty content lines (width 0)', () => {
			const sizes = [new Size2D(0, 20), new Size2D(0, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.strictEqual(context.availableSpaceSizes[0].width, 500);
			assert.strictEqual(context.availableSpaceSizes[1].width, 500);
		});

		test('handles varying line heights', () => {
			const sizes = [new Size2D(100, 10), new Size2D(100, 30), new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(1, sizes, 100);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			assert.deepStrictEqual(context.availableSpaceHeightPrefixSums, [0, 10, 40, 60]);
		});

		test('handles very large line numbers', () => {
			const sizes = [new Size2D(100, 20)];
			const lineRangeInfo = createLineRangeInfo(10000, sizes, 0);

			const context = new WidgetPlacementContext(lineRangeInfo, 500, () => 0);

			const outline = context.getWidgetVerticalOutline(10000, 50, defaultLayoutConstants);
			assert.ok(outline !== undefined);
		});
	});
});
