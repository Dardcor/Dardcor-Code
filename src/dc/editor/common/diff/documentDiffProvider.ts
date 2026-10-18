/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { MovedText } from './linesDiffComputer.js';
import { DetailedLineRangeMapping } from './rangeMapping.js';
import { ITextModel } from '../model.js';

/**
 * A document diff provider computes the diff between two text models.
 * @internal
 */
export interface IDocumentDiffProvider {
	computeDiff(original: ITextModel, modified: ITextModel, options: IDocumentDiffProviderOptions, cancellationToken: CancellationToken): Promise<IDocumentDiff>;

	readonly onDidChange: Event<void>;
}

/**
 * Options for the diff computation.
 * @internal
 */
export interface IDocumentDiffProviderOptions {
	ignoreTrimWhitespace: boolean;

	maxComputationTimeMs: number;

	computeMoves: boolean;

	extendToSubwords?: boolean;
}

/**
 * Represents a diff between two text models.
 * @internal
 */
export interface IDocumentDiff {
	readonly identical: boolean;

	readonly quitEarly: boolean;

	readonly changes: readonly DetailedLineRangeMapping[];

	readonly moves: readonly MovedText[];
}


export const nullDocumentDiff: IDocumentDiff = Object.freeze({
	identical: true,
	quitEarly: false,
	changes: Object.freeze([]),
	moves: Object.freeze([])
});
