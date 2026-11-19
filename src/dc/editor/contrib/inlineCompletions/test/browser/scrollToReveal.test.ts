/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { OffsetRange } from '../../../../common/core/ranges/offsetRange.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { scrollToReveal } from '../../browser/view/inlineEdits/inlineEditsViews/longDistanceHint/inlineEditsLongDistanceHint.js';

suite('scrollToReveal', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should not scroll when content is already visible', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(20, 30));
		assert.strictEqual(result.newScrollPosition, 10);
	});

	test('should not scroll when content exactly fits the visible window', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(10, 50));
		assert.strictEqual(result.newScrollPosition, 10);
	});

	test('should scroll left when content starts before visible window', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(5, 15));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should scroll right when content ends after visible window', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(50, 80));
		assert.strictEqual(result.newScrollPosition, 40);
	});

	test('should show start of content when content is larger than window', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(20, 100));
		assert.strictEqual(result.newScrollPosition, 20);
	});

	test('should handle edge case with zero-width content', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(25, 25));
		assert.strictEqual(result.newScrollPosition, 10);
	});

	test('should handle edge case with zero window width', () => {
		const result = scrollToReveal(10, 0, new OffsetRange(20, 30));
		assert.strictEqual(result.newScrollPosition, 20);
	});

	test('should handle content at exact window boundaries - left edge', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(10, 20));
		assert.strictEqual(result.newScrollPosition, 10);
	});

	test('should handle content at exact window boundaries - right edge', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(40, 50));
		assert.strictEqual(result.newScrollPosition, 10);
	});

	test('should scroll right when content extends beyond right boundary', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(40, 60));
		assert.strictEqual(result.newScrollPosition, 20);
	});

	test('should scroll left when content extends beyond left boundary', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(5, 25));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should handle content overlapping both boundaries', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(5, 70));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should handle negative scroll positions', () => {
		const result = scrollToReveal(-10, 40, new OffsetRange(35, 45));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should handle large numbers', () => {
		const result = scrollToReveal(1000000, 500, new OffsetRange(1000600, 1000700));
		assert.strictEqual(result.newScrollPosition, 1000200);
	});

	test('should prioritize left scroll when content spans window but starts before', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(5, 55));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should handle single character content requiring scroll', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(100, 101));
		assert.strictEqual(result.newScrollPosition, 61);
	});

	test('should handle content just barely outside visible area - left', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(9, 19));
		assert.strictEqual(result.newScrollPosition, 9);
	});

	test('should handle content just barely outside visible area - right', () => {
		const result = scrollToReveal(10, 40, new OffsetRange(45, 51));
		assert.strictEqual(result.newScrollPosition, 11);
	});

	test('should handle fractional-like scenarios with minimum window', () => {
		const result = scrollToReveal(50, 1, new OffsetRange(100, 105));
		assert.strictEqual(result.newScrollPosition, 100);
	});

	test('should preserve scroll when content partially visible on left', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(5, 25));
		assert.strictEqual(result.newScrollPosition, 5);
	});

	test('should preserve scroll when content partially visible on right', () => {
		const result = scrollToReveal(20, 40, new OffsetRange(45, 65));
		assert.strictEqual(result.newScrollPosition, 25);
	});
});
