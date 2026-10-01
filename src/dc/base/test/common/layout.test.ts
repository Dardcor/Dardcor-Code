/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AnchorAlignment, AnchorPosition, layout, layout2d, LayoutAnchorPosition } from '../../common/layout.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from './utils.js';

suite('Layout', function () {

	test('layout', () => {
		assert.strictEqual(layout(200, 20, { offset: 0, size: 0, position: LayoutAnchorPosition.Before }).position, 0);
		assert.strictEqual(layout(200, 20, { offset: 50, size: 0, position: LayoutAnchorPosition.Before }).position, 50);
		assert.strictEqual(layout(200, 20, { offset: 200, size: 0, position: LayoutAnchorPosition.Before }).position, 180);

		assert.strictEqual(layout(200, 20, { offset: 0, size: 0, position: LayoutAnchorPosition.After }).position, 0);
		assert.strictEqual(layout(200, 20, { offset: 50, size: 0, position: LayoutAnchorPosition.After }).position, 30);
		assert.strictEqual(layout(200, 20, { offset: 200, size: 0, position: LayoutAnchorPosition.After }).position, 180);
		assert.strictEqual(layout(200, 20, { offset: 0, size: 50, position: LayoutAnchorPosition.Before }).position, 50);
		assert.strictEqual(layout(200, 20, { offset: 50, size: 50, position: LayoutAnchorPosition.Before }).position, 100);
		assert.strictEqual(layout(200, 20, { offset: 150, size: 50, position: LayoutAnchorPosition.Before }).position, 130);

		assert.strictEqual(layout(200, 20, { offset: 0, size: 50, position: LayoutAnchorPosition.After }).position, 50);
		assert.strictEqual(layout(200, 20, { offset: 50, size: 50, position: LayoutAnchorPosition.After }).position, 30);
		assert.strictEqual(layout(200, 20, { offset: 150, size: 50, position: LayoutAnchorPosition.After }).position, 130);
	});

	test('layout2d with preventAvoid keeps horizontal alignment even when vertically overlapping', () => {
		const viewport = { top: 0, left: 0, width: 1024, height: 680 };
		const anchor = { top: 250, left: 240, width: 509, height: 99 };
		// Overlapping height (260 > 250)
		const view = { width: 509, height: 260 };

		// Default behavior: overlaps vertically, switches to AVOID, thrown to right
		const defaultResult = layout2d(viewport, view, anchor, { anchorPosition: AnchorPosition.ABOVE, anchorAlignment: AnchorAlignment.LEFT });
		assert.strictEqual(defaultResult.top, 0);
		assert.strictEqual(defaultResult.left, 515);

		// With preventAvoid: true, stays aligned with anchor.left (240)
		const preventedResult = layout2d(viewport, view, anchor, { anchorPosition: AnchorPosition.ABOVE, anchorAlignment: AnchorAlignment.LEFT, preventAvoid: true });
		assert.strictEqual(preventedResult.top, 0);
		assert.strictEqual(preventedResult.left, 240);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
