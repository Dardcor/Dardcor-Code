/**
 * Dardcor Code - Suggestion Relevance Fuzzy Scoring Algorithm
 */

import { CompletionItem } from "./completion-item.js";

export interface IScoreResult {
	readonly score: number;
	readonly matchKind: "prefix" | "substring" | "fuzzy" | "exact";
	readonly positions: number[];
}

export interface ISortedSuggestion {
	readonly item: CompletionItem;
	readonly result: IScoreResult;
	readonly originalIndex: number;
}

const NO_RESULT: IScoreResult = { score: -1, matchKind: "fuzzy", positions: [] };

/**
 * Scores a single suggestion label against the query.
 *
 * Tiering: exact match > prefix > substring > fuzzy subsequence. Within a
 * tier, consecutive matches, word boundaries and camel-case transitions add
 * points. Returns a result with score -1 when there is no match at all.
 */
export function scoreSuggestion(query: string, label: string): IScoreResult {
	if (query.length === 0) {
		return { score: 0, matchKind: "fuzzy", positions: [] };
	}
	const q = query.toLowerCase();
	const t = label.toLowerCase();
	if (q.length > t.length) {
		return NO_RESULT;
	}

	const positions: number[] = [];
	let qi = 0;
	let score = 0;
	let streak = 0;
	let lastMatch = -2;
	let firstMatch = -1;

	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] !== q[qi]) {
			continue;
		}
		positions.push(ti);
		if (firstMatch === -1) {
			firstMatch = ti;
		}
		if (ti === lastMatch + 1) {
			streak++;
			score += 3 + streak;
		} else {
			streak = 0;
			score += isWordStart(label, ti) ? 6 : 1;
		}
		lastMatch = ti;
		qi++;
	}
	if (qi < q.length) {
		return NO_RESULT;
	}

	let matchKind: IScoreResult["matchKind"];
	if (t === q) {
		matchKind = "exact";
		score += 1000;
	} else if (t.startsWith(q)) {
		matchKind = "prefix";
		score += 200;
	} else if (t.includes(q)) {
		matchKind = "substring";
		score += 100;
	} else {
		matchKind = "fuzzy";
	}
	if (isWordStart(label, firstMatch)) {
		score += 4;
	}
	for (let i = 1; i < positions.length; i++) {
		if (positions[i] === positions[i - 1] + 1) {
			score += 1;
		}
	}
	// Shorter labels are preferred at equal match quality.
	score += Math.max(0, 20 - t.length);
	return { score, matchKind, positions };
}

function isWordStart(target: string, index: number): boolean {
	if (index === 0) {
		return true;
	}
	const prev = target[index - 1];
	const current = target[index];
	return prev === " " || prev === "_" || prev === "-" || prev === "/" || prev === "." || prev === "\\" ||
		(prev === prev.toLowerCase() && current === current.toUpperCase() && prev !== current);
}

function isMatchResult(result: IScoreResult): boolean {
	return result.score >= 0;
}

/**
 * Stable sorter: items with a higher score come first, ties are broken by
 * the original index (stability), then by sortText.
 */
export function sortSuggestions(items: readonly CompletionItem[], query: string): ISortedSuggestion[] {
	const scored: ISortedSuggestion[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		let result = scoreSuggestion(query, item.filterText);
		if (!isMatchResult(result)) {
			result = scoreSuggestion(query, item.label);
		}
		if (!isMatchResult(result)) {
			continue;
		}
		if (item.isFavorite) {
			result = { ...result, score: result.score + 50 };
		}
		if (item.preselect) {
			result = { ...result, score: result.score + 25 };
		}
		scored.push({ item, result, originalIndex: i });
	}
	scored.sort((a, b) => {
		if (b.result.score !== a.result.score) {
			return b.result.score - a.result.score;
		}
		const sortDiff = a.item.sortText.localeCompare(b.item.sortText);
		if (sortDiff !== 0) {
			return sortDiff;
		}
		return a.originalIndex - b.originalIndex;
	});
	return scored;
}

export class SuggestSorter {
	public sort(items: readonly CompletionItem[], query: string): ISortedSuggestion[] {
		return sortSuggestions(items, query);
	}

	public rank(query: string, label: string): number {
		return scoreSuggestion(query, label).score;
	}

	public getMatchKind(query: string, label: string): IScoreResult["matchKind"] {
		const result = scoreSuggestion(query, label);
		return result.score < 0 ? "fuzzy" : result.matchKind;
	}

	public hasMatch(query: string, label: string): boolean {
		return scoreSuggestion(query, label).score >= 0;
	}
}

export { isMatchResult as isSuggestionMatch };
