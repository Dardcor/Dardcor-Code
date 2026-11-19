/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IArcTextReplacement } from '../../../base/common/editArcTracker.js';

export interface IDiffCountResult {
	added: number;
	removed: number;
	changes: readonly IOffsetEdit[];
}

export interface IOffsetEdit {
	startOffset: number;
	endOffsetExclusive: number;
	newText: string;
}

export interface IDetailedDiffResult {
	added: number;
	removed: number;
	replacements: readonly IArcTextReplacement[];
	hitTimeout: boolean;
}

export const IDiffComputeService = createDecorator<IDiffComputeService>('diffComputeService');

export const DEFAULT_DIFF_TIMEOUT_MS = 5000;

export interface IDiffComputeService {
	readonly _serviceBrand: undefined;

	computeDiffCounts(original: string, modified: string, timeoutMs?: number): Promise<IDiffCountResult>;

	computeDetailedDiff(original: string, modified: string, timeoutMs?: number): Promise<IDetailedDiffResult>;
}
