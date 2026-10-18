/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringEdit } from '../../../util/dardcor/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../util/dardcor/editor/common/core/ranges/offsetRange';

export class EditSurvivalTracker {
	private _text: string;
	private readonly _originalEdits: StringEdit;
	private _combinedEditsSinceStart = StringEdit.empty;
	private readonly _textAfterTrackedEdits: string;

	constructor(
		private readonly originalText: string,
		trackedEdits: StringEdit,
	) {
		this._text = trackedEdits.apply(this.originalText);
		this._textAfterTrackedEdits = this._text;
		this._originalEdits = trackedEdits;
	}

	handleEdits(edit: StringEdit): void {
		const newText = edit.apply(this._text);
		let newEdits = this._combinedEditsSinceStart.compose(edit);
		newEdits = newEdits.removeCommonSuffixPrefix(this._textAfterTrackedEdits);
		this._combinedEditsSinceStart = newEdits;
		this._text = newText;
	}

	computeTrackedEditsSurvivalScore(): { fourGram: number; noRevert: number; textBeforeAiEdits: string[]; textAfterAiEdits: string[]; textAfterUserEdits: string[] } {
		let similarityScoreSumFourGram = 0;
		let similarityScoreSumMax = 0;

		let noRevertSum = 0;
		let noRevertSumMax = 0;

		const allTextBefore: string[] = [];
		const allTextAfter: string[] = [];
		const allTextCurrent: string[] = [];

		const ranges = this._originalEdits.getNewRanges();
		const updatedRanges = applyEditsToRanges(ranges, this._combinedEditsSinceStart);

		for (let i = 0; i < ranges.length; i++) {
			const originalEdit = this._originalEdits.replacements[i];

			const textBeforeAiEdits = this.originalText.substring(originalEdit.replaceRange.start, originalEdit.replaceRange.endExclusive);
			const textAfterAiEdits = originalEdit.newText;
			const newRange = updatedRanges[i];
			const textAfterUserEdits = this._text.substring(newRange.start, newRange.endExclusive);

			allTextBefore.push(textBeforeAiEdits);
			allTextAfter.push(textAfterAiEdits);
			allTextCurrent.push(textAfterUserEdits);

			const similarity = compute4GramTextSimilarity(textAfterUserEdits, textAfterAiEdits);

			const aiEditSimilarity = compute4GramTextSimilarity(textAfterAiEdits, textBeforeAiEdits);
			const userEditSimilarity = compute4GramTextSimilarity(textAfterUserEdits, textBeforeAiEdits);
			if (aiEditSimilarity !== 1) {
				const v = 1 - Math.max(userEditSimilarity - aiEditSimilarity, 0) / (1 - aiEditSimilarity);
				noRevertSum += originalEdit.replaceRange.length * v;
				noRevertSumMax += originalEdit.replaceRange.length;
			}

			const similarityScoreFourGram = originalEdit.newText.length * similarity;
			const similarityScoreMax = originalEdit.newText.length;

			similarityScoreSumFourGram += similarityScoreFourGram;
			similarityScoreSumMax += similarityScoreMax;
		}

		return {
			fourGram: similarityScoreSumMax === 0 ? 1 : (similarityScoreSumFourGram / similarityScoreSumMax),
			noRevert: noRevertSumMax === 0 ? 1 : (noRevertSum / noRevertSumMax),
			textBeforeAiEdits: allTextBefore,
			textAfterAiEdits: allTextAfter,
			textAfterUserEdits: allTextCurrent,
		};
	}
}

export function compute4GramTextSimilarity(text1: string, text2: string): number {
	const n = 4;

	if (text1.length < n || text2.length < n) {
		return text1 === text2 ? 1 : 0;
	}

	const nGramIdx = new Map<string, number>();

	for (let i = 0; i <= text1.length - n; i++) {
		const nGram = text1.substring(i, i + n);
		const count = nGramIdx.get(nGram) || 0;
		nGramIdx.set(nGram, count + 1);
	}

	for (let i = 0; i <= text2.length - n; i++) {
		const nGram = text2.substring(i, i + n);
		const count = nGramIdx.get(nGram) || 0;
		nGramIdx.set(nGram, count - 1);
	}

	const totalNGramCount = text1.length - n + 1 + text2.length - n + 1;

	let differentNGramCount = 0;
	for (const count of nGramIdx.values()) {
		differentNGramCount += Math.abs(count);
	}

	const equalNGramCount = totalNGramCount - differentNGramCount;

	return equalNGramCount / totalNGramCount;
}

export function applyEditsToRanges(sortedRanges: OffsetRange[], edits: StringEdit): OffsetRange[] {
	sortedRanges = sortedRanges.slice();

	const result: OffsetRange[] = [];

	let offset = 0;

	for (const e of edits.replacements) {
		while (true) {
			const r = sortedRanges[0];
			if (!r || r.endExclusive >= e.replaceRange.start) {
				break;
			}
			sortedRanges.shift();
			result.push(r.delta(offset));
		}

		const intersecting: OffsetRange[] = [];
		while (true) {
			const r = sortedRanges[0];
			if (!r || !r.intersectsOrTouches(e.replaceRange)) {
				break;
			}
			sortedRanges.shift();
			intersecting.push(r);
		}

		for (let i = intersecting.length - 1; i >= 0; i--) {
			let r = intersecting[i];

			const overlap = r.intersect(e.replaceRange)!.length;
			r = r.deltaEnd(-overlap + (i === 0 ? e.newText.length : 0));

			const rangeAheadOfReplaceRange = r.start - e.replaceRange.start;
			if (rangeAheadOfReplaceRange > 0) {
				r = r.delta(-rangeAheadOfReplaceRange);
			}

			if (i !== 0) {
				r = r.delta(e.newText.length);
			}

			r = r.delta(-(e.newText.length - e.replaceRange.length));

			sortedRanges.unshift(r);
		}

		offset += e.newText.length - e.replaceRange.length;
	}

	while (true) {
		const r = sortedRanges[0];
		if (!r) {
			break;
		}
		sortedRanges.shift();
		result.push(r.delta(offset));
	}

	return result;
}
