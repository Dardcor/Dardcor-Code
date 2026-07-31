/**
 * Dardcor Code - Score-Ranked Fuzzy Matcher For Command Palette Results
 */

export interface IFuzzyMatch {
	readonly score: number;
	readonly positions: number[];
}

export interface IRankedMatch<T> {
	readonly item: T;
	readonly match: IFuzzyMatch;
}

const NO_MATCH: IFuzzyMatch = { score: 0, positions: [] };

function isWordStart(target: string, index: number): boolean {
	if (index === 0) {
		return true;
	}
	const prev = target[index - 1];
	const current = target[index];
	return prev === ' ' || prev === '_' || prev === '-' || prev === '/' || prev === '.' || prev === '\\' ||
		(prev === prev.toLowerCase() && current === current.toUpperCase() && prev !== current);
}

/**
 * Scores how well `query` appears as a subsequence of `target`.
 * Returns null when the query is not contained in the target.
 * Higher score = better match (prefer prefix, word starts and streaks).
 */
export function fuzzyScore(query: string, target: string): IFuzzyMatch | null {
	if (!query) {
		return { score: 1, positions: [] };
	}
	const q = query.toLowerCase();
	const t = target.toLowerCase();
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
		// Bonuses
		if (ti === lastMatch + 1) {
			streak++;
			score += 3 + streak;
		} else {
			streak = 0;
			score += isWordStart(target, ti) ? 6 : 1;
		}
		lastMatch = ti;
		qi++;
	}
	if (qi < q.length) {
		return null;
	}
	// Prefix match bonus
	if (t.startsWith(q)) {
		score += 20;
	}
	// Word-start of first character bonus
	if (isWordStart(target, firstMatch)) {
		score += 4;
	}
	// Camel-case boundary bonus
	for (let i = 1; i < positions.length; i++) {
		if (positions[i] === positions[i - 1] + 1) {
			score += 1;
		}
	}
	return { score, positions };
}

export function hasFuzzyMatch(query: string, target: string): boolean {
	return fuzzyScore(query, target) !== null;
}

export function createHighlightMarkup(match: IFuzzyMatch, target: string): string {
	let html = '';
	let last = 0;
	for (const pos of match.positions) {
		if (pos > last) {
			html += escapeHtml(target.substring(last, pos));
		}
		html += `<span class="dc-fuzzy-highlight">${escapeHtml(target[pos])}</span>`;
		last = pos + 1;
	}
	if (last < target.length) {
		html += escapeHtml(target.substring(last));
	}
	return html;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class QuickPickFilter<T> {
	constructor(
		private readonly _getSearchText: (item: T) => string,
		private readonly _getSortText?: (item: T) => string
	) {}

	filter(query: string, items: T[]): IRankedMatch<T>[] {
		const q = query.trim();
		if (!q) {
			return items.map(item => ({ item, match: { score: 1, positions: [] } }));
		}
		const results: IRankedMatch<T>[] = [];
		for (const item of items) {
			const searchText = this._getSearchText(item);
			if (!searchText) {
				continue;
			}
			const match = fuzzyScore(q, searchText);
			if (match) {
				results.push({ item, match });
			}
		}
		results.sort((a, b) => {
			const scoreDiff = b.match.score - a.match.score;
			if (scoreDiff !== 0) {
				return scoreDiff;
			}
			const aText = this._getSortText?.(a.item) ?? this._getSearchText(a.item);
			const bText = this._getSortText?.(b.item) ?? this._getSearchText(b.item);
			return aText.localeCompare(bText);
		});
		return results;
	}

	rank(query: string, target: string): number {
		return fuzzyScore(query, target)?.score ?? 0;
	}

	static get instance(): QuickPickFilter<string> {
		return new QuickPickFilter<string>(value => value);
	}
}
