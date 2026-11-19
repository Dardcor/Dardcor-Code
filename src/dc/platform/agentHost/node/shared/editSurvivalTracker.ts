/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


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

export function computeFractionPresentIn(chunk: string, currentText: string): number {
	const n = 4;
	if (chunk.length === 0) {
		return 1;
	}
	if (chunk.length < n) {
		return currentText.includes(chunk) ? 1 : 0;
	}
	if (currentText.length < n) {
		return 0;
	}
	return computeFractionPresentInSet(chunk, buildNGramSet(currentText, n), n);
}

function buildNGramSet(text: string, n: number): Set<string> {
	const set = new Set<string>();
	for (let i = 0; i <= text.length - n; i++) {
		set.add(text.substring(i, i + n));
	}
	return set;
}

function computeFractionPresentInSet(chunk: string, fileNGrams: ReadonlySet<string>, n: number): number {
	const total = chunk.length - n + 1;
	let present = 0;
	for (let i = 0; i < total; i++) {
		if (fileNGrams.has(chunk.substring(i, i + n))) {
			present++;
		}
	}
	return present / total;
}

export function computeChunkedFourGramSurvival(aiChunks: readonly string[], currentText: string): number {
	if (aiChunks.length === 0) {
		return 0;
	}

	const n = 4;
	const fileNGrams = currentText.length >= n ? buildNGramSet(currentText, n) : undefined;

	let totalWeight = 0;
	let weightedSum = 0;
	for (const chunk of aiChunks) {
		const weight = Math.max(1, chunk.length - n + 1);
		let fraction: number;
		if (chunk.length === 0) {
			fraction = 1;
		} else if (chunk.length < n) {
			fraction = currentText.includes(chunk) ? 1 : 0;
		} else if (!fileNGrams) {
			fraction = 0;
		} else {
			fraction = computeFractionPresentInSet(chunk, fileNGrams, n);
		}
		weightedSum += fraction * weight;
		totalWeight += weight;
	}
	return weightedSum / totalWeight;
}

export interface IEditSurvivalScore {
	readonly fourGram: number;
	readonly noRevert: number;
}

export function computeNoRevertScore(beforeText: string, afterText: string, currentText: string): number {
	const aiSimilarity = compute4GramTextSimilarity(afterText, beforeText);
	if (aiSimilarity === 1) {
		return 1;
	}
	const userSimilarity = compute4GramTextSimilarity(currentText, beforeText);
	return 1 - Math.max(userSimilarity - aiSimilarity, 0) / (1 - aiSimilarity);
}

export function computeWholeFileEditSurvival(
	beforeText: string,
	afterText: string,
	currentText: string,
): IEditSurvivalScore {
	return {
		fourGram: compute4GramTextSimilarity(currentText, afterText),
		noRevert: computeNoRevertScore(beforeText, afterText, currentText),
	};
}

export function computeChunkedEditSurvival(
	beforeText: string,
	afterText: string,
	aiChunks: readonly string[],
	currentText: string,
): IEditSurvivalScore {
	const fourGram = aiChunks.length === 0
		? compute4GramTextSimilarity(currentText, afterText)
		: computeChunkedFourGramSurvival(aiChunks, currentText);
	return {
		fourGram,
		noRevert: computeNoRevertScore(beforeText, afterText, currentText),
	};
}
