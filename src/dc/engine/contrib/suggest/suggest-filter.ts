/**
 * Dardcor Code - Fuzzy Filter For Suggestion Items
 */

import { CompletionItem } from "./completion-item.js";

export interface IFuzzyFilterMatch {
	readonly score: number;
	readonly positions: number[];
}

export interface IFuzzyFilterResult {
	readonly item: CompletionItem;
	readonly match: IFuzzyFilterMatch;
	readonly originalIndex: number;
}

const NO_MATCH: IFuzzyFilterMatch = { score: 0, positions: [] };

function isWordStart(target: string, index: number): boolean {
	if (index === 0) {
		return true;
	}
	const prev = target[index - 1];
	const current = target[index];
	return prev === " " || prev === "_" || prev === "-" || prev === "/" || prev === "." || prev === "\\" ||
		(prev === prev.toLowerCase() && current === current.toUpperCase() && prev !== current);
}

/**
 * Subsequence matcher: every character of the query must appear in order in
 * the label. Scoring prefers prefix matches, word starts and streaks. A score
 * of 0 means "no match"; this mirrors the quick pick filter used elsewhere in
 * the app shell but stays self-contained to avoid a layering cycle between
 * the engine and the app shell.
 */
export function fuzzyMatch(query: string, label: string): IFuzzyFilterMatch | null {
	if (!query) {
		return { score: 1, positions: [] };
	}
	const q = query.toLowerCase();
	const t = label.toLowerCase();
	if (q.length > t.length) {
		return null;
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
		return null;
	}
	if (t.startsWith(q)) {
		score += 20;
	}
	if (isWordStart(label, firstMatch)) {
		score += 4;
	}
	for (let i = 1; i < positions.length; i++) {
		if (positions[i] === positions[i - 1] + 1) {
			score += 1;
		}
	}
	return { score, positions };
}

export function hasFuzzyMatch(query: string, label: string): boolean {
	return fuzzyMatch(query, label) !== null;
}

/**
 * Filters suggestion items with the fuzzy matcher and ranks them by score
 * (stable - ties keep the original order). Honors the item's own filterText.
 */
export class SuggestFilter {
	private readonly _getText: (item: CompletionItem) => string;

	constructor(getText: (item: CompletionItem) => string = item => item.filterText) {
		this._getText = getText;
	}

	public filter(query: string, items: readonly CompletionItem[]): IFuzzyFilterResult[] {
		const results: IFuzzyFilterResult[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			const text = this._getText(item);
			if (!text) {
				continue;
			}
			let match = fuzzyMatch(query, text);
			if (!match) {
				match = fuzzyMatch(query, item.label);
			}
			if (match) {
				results.push({ item, match, originalIndex: i });
			}
		}
		results.sort((a, b) => {
			if (b.match.score !== a.match.score) {
				return b.match.score - a.match.score;
			}
			return a.originalIndex - b.originalIndex;
		});
		return results;
	}

	public rank(query: string, label: string): number {
		return fuzzyMatch(query, label)?.score ?? 0;
	}

	public static matches(query: string, label: string): boolean {
		return hasFuzzyMatch(query, label);
	}
}

export function filterSuggestions(items: readonly CompletionItem[], query: string): CompletionItem[] {
	return new SuggestFilter().filter(query, items).map(result => result.item);
}
