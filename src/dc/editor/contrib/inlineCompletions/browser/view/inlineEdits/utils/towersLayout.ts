/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Size2D } from '../../../../../../common/core/2d/size.js';
import { OffsetRange } from '../../../../../../common/core/ranges/offsetRange.js';

export function getMaxTowerHeightInAvailableArea(towerHorizontalRange: OffsetRange, availableTowerAreas: Size2D[]): number {
	const towerLeftOffset = towerHorizontalRange.start;
	const towerRightOffset = towerHorizontalRange.endExclusive;

	let minHeight = Number.MAX_VALUE;

	let currentLeftOffset = 0;
	for (const availableArea of availableTowerAreas) {
		const currentRightOffset = currentLeftOffset + availableArea.width;

		const overlapLeft = Math.max(towerLeftOffset, currentLeftOffset);
		const overlapRight = Math.min(towerRightOffset, currentRightOffset);

		if (overlapLeft < overlapRight) {
			minHeight = Math.min(minHeight, availableArea.height);
		}

		currentLeftOffset = currentRightOffset;
	}

	if (towerRightOffset > currentLeftOffset) {
		return 0;
	}

	return minHeight === Number.MAX_VALUE ? 0 : minHeight;
}
