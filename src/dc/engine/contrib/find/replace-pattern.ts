/**
 * Dardcor Code - Regex Match String Substitution Engine
 */

export class ReplacePattern {
	public readonly source: string;

	constructor(source: string) {
		this.source = source;
	}

	public getReplaceString(matchText: string, captureGroups: readonly string[] = []): string {
		return ReplacePattern.substitute(this.source, matchText, captureGroups);
	}

	public hasReplacementPatterns(): boolean {
		return /\$\$|\$(\d{1,2})|\$\{(\d{1,2})\}/.test(this.source);
	}

	public static substitute(source: string, matchText: string, captureGroups: readonly string[] = []): string {
		return source.replace(
			/(?:\$\$)|(?:\$(\d{1,2}))|(?:\$\{(\d{1,2})\})/g,
			(match, group: string | undefined, braced: string | undefined) => {
				if (group === undefined && braced === undefined) {
					// `$$` - literal dollar sign
					return "$";
				}
				const index = Number(group ?? braced);
				if (index === 0) {
					return matchText;
				}
				if (index > captureGroups.length) {
					return "";
				}
				return captureGroups[index - 1] ?? "";
			}
		);
	}

	public static createSubstitutionList(replacements: readonly string[], matchTexts: readonly string[], captureGroupsList: readonly (readonly string[])[]): string[] {
		return replacements.map((replacement, i) =>
			ReplacePattern.substitute(replacement, matchTexts[i] ?? "", captureGroupsList[i] ?? [])
		);
	}
}

export function expandReplacementPattern(replacement: string, matchText: string, captureGroups: readonly string[] = []): string {
	return ReplacePattern.substitute(replacement, matchText, captureGroups);
}

export function isReplacementPattern(text: string): boolean {
	return new ReplacePattern(text).hasReplacementPatterns();
}

export function extractCaptureGroups(regex: RegExp, text: string): string[][] {
	const groups: string[][] = [];
	for (const match of text.matchAll(regex)) {
		groups.push(match.slice(1).map(g => g ?? ""));
	}
	return groups;
}
