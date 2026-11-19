/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DetailedLineRangeMapping, LineRangeMapping } from './rangeMapping';

export interface ILinesDiffComputer {
	computeDiff(originalLines: string[], modifiedLines: string[], options: ILinesDiffComputerOptions): LinesDiff;
}

export interface ILinesDiffComputerOptions {
	readonly ignoreTrimWhitespace: boolean;
	readonly maxComputationTimeMs: number;
	readonly computeMoves: boolean;
	readonly extendToSubwords?: boolean;
}

export class LinesDiff {
	constructor(
		readonly changes: readonly DetailedLineRangeMapping[],

		readonly moves: readonly MovedText[],

		readonly hitTimeout: boolean,
	) {
	}
}

export class MovedText {
	public readonly lineRangeMapping: LineRangeMapping;

	public readonly changes: readonly DetailedLineRangeMapping[];

	constructor(
		lineRangeMapping: LineRangeMapping,
		changes: readonly DetailedLineRangeMapping[],
	) {
		this.lineRangeMapping = lineRangeMapping;
		this.changes = changes;
	}

	public flip(): MovedText {
		return new MovedText(this.lineRangeMapping.flip(), this.changes.map(c => c.flip()));
	}
}
