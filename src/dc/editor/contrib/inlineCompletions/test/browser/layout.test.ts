/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { Size2D } from '../../../../common/core/2d/size.js';
import { OffsetRange } from '../../../../common/core/ranges/offsetRange.js';
import { getMaxTowerHeightInAvailableArea } from '../../browser/view/inlineEdits/utils/towersLayout.js';

suite('Layout - getMaxTowerHeightInAvailableArea', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('tower fits within single available area', () => {
		const towerHorizontalRange = new OffsetRange(5, 15);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 30);
	});

	test('max height available in area', () => {
		const towerHorizontalRange = new OffsetRange(5, 15);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 30);
	});

	test('tower extends beyond available width', () => {
		const towerHorizontalRange = new OffsetRange(0, 60);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 0);
	});

	test('tower fits across multiple available areas', () => {
		const towerHorizontalRange = new OffsetRange(10, 40);
		const availableTowerAreas = [
			new Size2D(20, 30),
			new Size2D(20, 25),
			new Size2D(20, 30)
		];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 25);
	});

	test('min height across overlapping areas', () => {
		const towerHorizontalRange = new OffsetRange(10, 40);
		const availableTowerAreas = [
			new Size2D(20, 30),
			new Size2D(20, 15),
			new Size2D(20, 30)
		];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 15);
	});

	test('tower at left edge of available areas', () => {
		const towerHorizontalRange = new OffsetRange(0, 10);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 30);
	});

	test('tower at right edge of available areas', () => {
		const towerHorizontalRange = new OffsetRange(40, 50);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 30);
	});

	test('tower exactly matches available area', () => {
		const towerHorizontalRange = new OffsetRange(0, 50);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 30);
	});

	test('empty available areas', () => {
		const towerHorizontalRange = new OffsetRange(0, 10);
		const availableTowerAreas: Size2D[] = [];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 0);
	});

	test('tower spans exactly two available areas', () => {
		const towerHorizontalRange = new OffsetRange(10, 50);
		const availableTowerAreas = [
			new Size2D(30, 25),
			new Size2D(30, 25)
		];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 25);
	});

	test('tower starts at boundary between two areas', () => {
		const towerHorizontalRange = new OffsetRange(30, 50);
		const availableTowerAreas = [
			new Size2D(30, 25),
			new Size2D(30, 25)
		];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 25);
	});

	test('tower with varying height available areas', () => {
		const towerHorizontalRange = new OffsetRange(0, 50);
		const availableTowerAreas = [
			new Size2D(10, 30),
			new Size2D(10, 15),
			new Size2D(10, 25),
			new Size2D(10, 30),
			new Size2D(10, 40)
		];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 15);
	});

	test('tower beyond all available areas to the right', () => {
		const towerHorizontalRange = new OffsetRange(100, 110);
		const availableTowerAreas = [new Size2D(50, 30)];

		assert.strictEqual(getMaxTowerHeightInAvailableArea(towerHorizontalRange, availableTowerAreas), 0);
	});
});
