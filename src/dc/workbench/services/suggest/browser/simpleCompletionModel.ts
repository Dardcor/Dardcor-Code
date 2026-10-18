/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SimpleCompletionItem } from './simpleCompletionItem.js';
import { quickSelect } from '../../../../base/common/arrays.js';
import { CharCode } from '../../../../base/common/charCode.js';
import { FuzzyScore, fuzzyScore, fuzzyScoreGracefulAggressive, FuzzyScoreOptions, FuzzyScorer } from '../../../../base/common/filters.js';

export interface ISimpleCompletionStats {
	pLabelLen: number;
}

export class LineContext {
	constructor(
		readonly leadingLineContent: string,
		readonly characterCountDelta: number,
	) { }
}

const enum Refilter {
	Nothing = 0,
	All = 1,
	Incr = 2
}

export class SimpleCompletionModel<T extends SimpleCompletionItem> {
	private _stats?: ISimpleCompletionStats;
	private _filteredItems?: T[];
	private _refilterKind: Refilter = Refilter.All;
	private _fuzzyScoreOptions: FuzzyScoreOptions | undefined = {
		...FuzzyScoreOptions.default,
		firstMatchCanBeWeak: true
	};

	private _options: {
		filterGraceful?: boolean;
	} = {};

	constructor(
		private readonly _items: T[],
		private _lineContext: LineContext,
		private readonly _rawCompareFn?: (leadingLineContent: string, a: T, b: T) => number,
	) {
	}

	get items(): T[] {
		this._ensureCachedState();
		return this._filteredItems!;
	}

	get stats(): ISimpleCompletionStats {
		this._ensureCachedState();
		return this._stats!;
	}


	get lineContext(): LineContext {
		return this._lineContext;
	}

	set lineContext(value: LineContext) {
		if (this._lineContext.leadingLineContent !== value.leadingLineContent
			|| this._lineContext.characterCountDelta !== value.characterCountDelta
		) {
			this._refilterKind = this._lineContext.characterCountDelta < value.characterCountDelta && this._filteredItems ? Refilter.Incr : Refilter.All;
			this._lineContext = value;
		}
	}

	forceRefilterAll() {
		this._refilterKind = Refilter.All;
	}

	private _ensureCachedState(): void {
		if (this._refilterKind !== Refilter.Nothing) {
			this._createCachedState();
		}
	}
	private _createCachedState(): void {


		const labelLengths: number[] = [];

		const { leadingLineContent, characterCountDelta } = this._lineContext;
		let word = '';
		let wordLow = '';

		const source = this._refilterKind === Refilter.All ? this._items : this._filteredItems!;
		const target: T[] = [];

		const scoreFn: FuzzyScorer = (!this._options.filterGraceful || source.length > 2000) ? fuzzyScore : fuzzyScoreGracefulAggressive;

		for (let i = 0; i < source.length; i++) {

			const item = source[i];

			if (item.isInvalid) {
				continue;
			}



			const overwriteBefore = item.completion.replacementRange ? (item.completion.replacementRange[1] - item.completion.replacementRange[0]) : 0;
			const wordLen = overwriteBefore + characterCountDelta;
			if (word.length !== wordLen) {
				word = wordLen === 0 ? '' : leadingLineContent.slice(-wordLen);
				wordLow = word.toLowerCase();
			}

			item.word = word;
			if (wordLen === 0) {
				item.score = FuzzyScore.Default;

			} else {
				let wordPos = 0;
				while (wordPos < overwriteBefore) {
					const ch = word.charCodeAt(wordPos);
					if (ch === CharCode.Space || ch === CharCode.Tab) {
						wordPos += 1;
					} else {
						break;
					}
				}

				if (wordPos >= wordLen) {
					item.score = FuzzyScore.Default;


				} else {
					const match = scoreFn(word, wordLow, wordPos, item.textLabel, item.labelLow, 0, this._fuzzyScoreOptions);
					if (!match && word !== '') {
						continue;
					}
					item.score = match || FuzzyScore.Default;
				}
			}
			item.idx = i;
			target.push(item);

			labelLengths.push(item.textLabel.length);
		}

		this._filteredItems = target.sort(this._rawCompareFn?.bind(undefined, leadingLineContent));
		this._refilterKind = Refilter.Nothing;

		this._stats = {
			pLabelLen: labelLengths.length ?
				quickSelect(labelLengths.length - .85, labelLengths, (a, b) => a - b)
				: 0
		};
	}
}
