/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CallbackIterable } from '../../base/common/arrays.js';
import { Event } from '../../base/common/event.js';
import { IPosition } from './core/position.js';
import { IRange, Range } from './core/range.js';
import { ClosingBracketKind, OpeningBracketKind } from './languages/supports/languageBracketsConfiguration.js';
import { PairAstNode } from './model/bracketPairsTextModelPart/bracketPairsTree/ast.js';

export interface IBracketPairsTextModelPart {
	readonly onDidChange: Event<void>;

	getBracketPairsInRange(range: IRange): CallbackIterable<BracketPairInfo>;

	getBracketPairsInRangeWithMinIndentation(range: IRange): CallbackIterable<BracketPairWithMinIndentationInfo>;

	getBracketsInRange(range: IRange, onlyColorizedBrackets?: boolean): CallbackIterable<BracketInfo>;

	findMatchingBracketUp(bracket: string, position: IPosition, maxDuration?: number): Range | null;

	findPrevBracket(position: IPosition): IFoundBracket | null;

	findNextBracket(position: IPosition): IFoundBracket | null;

	findEnclosingBrackets(position: IPosition, maxDuration?: number): [Range, Range] | null;

	matchBracket(position: IPosition, maxDuration?: number): [Range, Range] | null;
}

export interface IFoundBracket {
	range: Range;
	bracketInfo: OpeningBracketKind | ClosingBracketKind;
}

export class BracketInfo {
	constructor(
		public readonly range: Range,
		public readonly nestingLevel: number,
		public readonly nestingLevelOfEqualBracketType: number,
		public readonly isInvalid: boolean,
	) { }
}

export class BracketPairInfo {
	constructor(
		public readonly range: Range,
		public readonly openingBracketRange: Range,
		public readonly closingBracketRange: Range | undefined,
		public readonly nestingLevel: number,
		public readonly nestingLevelOfEqualBracketType: number,
		private readonly bracketPairNode: PairAstNode,

	) {
	}

	public get openingBracketInfo(): OpeningBracketKind {
		return this.bracketPairNode.openingBracket.bracketInfo as OpeningBracketKind;
	}

	public get closingBracketInfo(): ClosingBracketKind | undefined {
		return this.bracketPairNode.closingBracket?.bracketInfo as ClosingBracketKind | undefined;
	}
}

export class BracketPairWithMinIndentationInfo extends BracketPairInfo {
	constructor(
		range: Range,
		openingBracketRange: Range,
		closingBracketRange: Range | undefined,
		nestingLevel: number,
		nestingLevelOfEqualBracketType: number,
		bracketPairNode: PairAstNode,
		public readonly minVisibleColumnIndentation: number,
	) {
		super(range, openingBracketRange, closingBracketRange, nestingLevel, nestingLevelOfEqualBracketType, bracketPairNode);
	}
}
