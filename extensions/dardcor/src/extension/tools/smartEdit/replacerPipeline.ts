/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { calculateSimilarity, levenshteinDistance } from './levenshtein';
import { isDisproportionateMatch } from './safetyGuards';

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

const BLOCK_ANCHOR_SIMILARITY_THRESHOLD = 0.65;

export const SimpleReplacer: Replacer = function* (_content, find) {
	yield find;
};

export const LineTrimmedReplacer: Replacer = function* (content, find) {
	const originalLines = content.split('\n');
	const searchLines = find.split('\n');

	if (searchLines[searchLines.length - 1] === '') {
		searchLines.pop();
	}

	for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
		let matches = true;

		for (let j = 0; j < searchLines.length; j++) {
			if (originalLines[i + j].trim() !== searchLines[j].trim()) {
				matches = false;
				break;
			}
		}

		if (matches) {
			let matchStartIndex = 0;
			for (let k = 0; k < i; k++) {
				matchStartIndex += originalLines[k].length + 1;
			}

			let matchEndIndex = matchStartIndex;
			for (let k = 0; k < searchLines.length; k++) {
				matchEndIndex += originalLines[i + k].length;
				if (k < searchLines.length - 1) {
					matchEndIndex += 1;
				}
			}

			yield content.substring(matchStartIndex, matchEndIndex);
		}
	}
};

export const BlockAnchorReplacer: Replacer = function* (content, find) {
	const originalLines = content.split('\n');
	const searchLines = find.split('\n');

	if (searchLines.length < 3) {
		return;
	}

	if (searchLines[searchLines.length - 1] === '') {
		searchLines.pop();
	}

	const firstLineSearch = searchLines[0].trim();
	const lastLineSearch = searchLines[searchLines.length - 1].trim();
	const searchBlockSize = searchLines.length;
	const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25));

	const candidates: Array<{ startLine: number; endLine: number }> = [];
	for (let i = 0; i < originalLines.length; i++) {
		if (originalLines[i].trim() !== firstLineSearch) {
			continue;
		}

		for (let j = i + 2; j < originalLines.length; j++) {
			if (originalLines[j].trim() === lastLineSearch) {
				const actualBlockSize = j - i + 1;
				if (Math.abs(actualBlockSize - searchBlockSize) <= maxLineDelta) {
					candidates.push({ startLine: i, endLine: j });
				}
				break;
			}
		}
	}

	if (candidates.length === 0) {
		return;
	}

	let bestMatch: { startLine: number; endLine: number } | null = null;
	let maxSimilarity = -1;

	for (const candidate of candidates) {
		const { startLine, endLine } = candidate;
		const actualBlockSize = endLine - startLine + 1;

		let similarity = 0;
		const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2);

		if (linesToCheck > 0) {
			for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
				const originalLine = originalLines[startLine + j].trim();
				const searchLine = searchLines[j].trim();
				const maxLen = Math.max(originalLine.length, searchLine.length);
				if (maxLen === 0) {
					continue;
				}
				const distance = levenshteinDistance(originalLine, searchLine);
				similarity += (1 - distance / maxLen);
			}
			similarity /= linesToCheck;
		} else {
			similarity = 1.0;
		}

		if (similarity > maxSimilarity) {
			maxSimilarity = similarity;
			bestMatch = candidate;
		}
	}

	if (maxSimilarity >= BLOCK_ANCHOR_SIMILARITY_THRESHOLD && bestMatch) {
		const { startLine, endLine } = bestMatch;
		let matchStartIndex = 0;
		for (let k = 0; k < startLine; k++) {
			matchStartIndex += originalLines[k].length + 1;
		}
		let matchEndIndex = matchStartIndex;
		for (let k = startLine; k <= endLine; k++) {
			matchEndIndex += originalLines[k].length;
			if (k < endLine) {
				matchEndIndex += 1;
			}
		}
		yield content.substring(matchStartIndex, matchEndIndex);
	}
};

export const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
	const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();
	const normalizedFind = normalizeWhitespace(find);

	const lines = content.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (normalizeWhitespace(line) === normalizedFind) {
			yield line;
		}
	}

	const findLines = find.split('\n');
	if (findLines.length > 1) {
		for (let i = 0; i <= lines.length - findLines.length; i++) {
			const block = lines.slice(i, i + findLines.length);
			if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
				yield block.join('\n');
			}
		}
	}
};

export const IndentationFlexibleReplacer: Replacer = function* (content, find) {
	const removeIndentation = (text: string) => {
		const lines = text.split('\n');
		const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
		if (nonEmptyLines.length === 0) {
			return text;
		}

		const minIndent = Math.min(
			...nonEmptyLines.map((line) => {
				const match = line.match(/^(\s*)/);
				return match ? match[1].length : 0;
			})
		);

		return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n');
	};

	const normalizedFind = removeIndentation(find);
	const contentLines = content.split('\n');
	const findLines = find.split('\n');

	for (let i = 0; i <= contentLines.length - findLines.length; i++) {
		const block = contentLines.slice(i, i + findLines.length).join('\n');
		if (removeIndentation(block) === normalizedFind) {
			yield block;
		}
	}
};

export const EscapeNormalizedReplacer: Replacer = function* (content, find) {
	const unescapeString = (str: string): string => {
		return str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
			switch (capturedChar) {
				case 'n': return '\n';
				case 't': return '\t';
				case 'r': return '\r';
				case '\'': return '\'';
				case '"': return '"';
				case '`': return '`';
				case '\\': return '\\';
				case '\n': return '\n';
				case '$': return '$';
				default: return match;
			}
		});
	};

	const unescapedFind = unescapeString(find);
	if (content.includes(unescapedFind)) {
		yield unescapedFind;
	}

	const lines = content.split('\n');
	const findLines = unescapedFind.split('\n');

	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join('\n');
		if (unescapeString(block) === unescapedFind) {
			yield block;
		}
	}

	// Handle case where find has unescaped quotes/slashes but content has escaped ones
	const quoteNormalizedFind = find.replace(/\\(["'`])/g, '$1');
	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join('\n');
		if (block.replace(/\\(["'`])/g, '$1') === quoteNormalizedFind) {
			yield block;
		}
	}
};

export const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
	const trimmedFind = find.trim();
	if (trimmedFind === find) {
		return;
	}

	if (content.includes(trimmedFind)) {
		yield trimmedFind;
	}

	const lines = content.split('\n');
	const findLines = find.split('\n');

	for (let i = 0; i <= lines.length - findLines.length; i++) {
		const block = lines.slice(i, i + findLines.length).join('\n');
		if (block.trim() === trimmedFind) {
			yield block;
		}
	}
};

export const ContextAwareReplacer: Replacer = function* (content, find) {
	const findLines = find.split('\n');
	if (findLines.length < 3) {
		return;
	}

	if (findLines[findLines.length - 1] === '') {
		findLines.pop();
	}

	const contentLines = content.split('\n');
	const firstLine = findLines[0].trim();
	const lastLine = findLines[findLines.length - 1].trim();

	for (let i = 0; i < contentLines.length; i++) {
		if (contentLines[i].trim() !== firstLine) {
			continue;
		}

		for (let j = i + 2; j < contentLines.length; j++) {
			if (contentLines[j].trim() === lastLine) {
				const blockLines = contentLines.slice(i, j + 1);
				if (blockLines.length === findLines.length) {
					let matchingLines = 0;
					let totalNonEmptyLines = 0;

					for (let k = 1; k < blockLines.length - 1; k++) {
						const blockLine = blockLines[k].trim();
						const findLine = findLines[k].trim();

						if (blockLine.length > 0 || findLine.length > 0) {
							totalNonEmptyLines++;
							if (blockLine === findLine) {
								matchingLines++;
							}
						}
					}

					if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
						yield blockLines.join('\n');
						return;
					}
				}
				break;
			}
		}
	}
};

export const MultiOccurrenceReplacer: Replacer = function* (content, find) {
	let startIndex = 0;
	while (true) {
		const index = content.indexOf(find, startIndex);
		if (index === -1) {
			break;
		}
		yield find;
		startIndex = index + find.length;
	}
};

export interface SmartReplaceResult {
	success: boolean;
	text: string;
	strategy: string;
	matchSpan?: { start: number; end: number; text: string };
	errorMessage?: string;
	multipleMatches?: boolean;
}

const REPLACER_PIPELINE: Array<{ name: string; replacer: Replacer }> = [
	{ name: 'exact', replacer: SimpleReplacer },
	{ name: 'line-trimmed', replacer: LineTrimmedReplacer },
	{ name: 'block-anchor', replacer: BlockAnchorReplacer },
	{ name: 'whitespace-normalized', replacer: WhitespaceNormalizedReplacer },
	{ name: 'indentation-flexible', replacer: IndentationFlexibleReplacer },
	{ name: 'escape-normalized', replacer: EscapeNormalizedReplacer },
	{ name: 'trimmed-boundary', replacer: TrimmedBoundaryReplacer },
	{ name: 'context-aware', replacer: ContextAwareReplacer },
	{ name: 'multi-occurrence', replacer: MultiOccurrenceReplacer },
];

export function smartReplaceOne(
	content: string,
	oldString: string,
	newString: string,
	options?: { replaceAll?: boolean }
): SmartReplaceResult {
	if (oldString === newString) {
		return {
			success: false,
			text: content,
			strategy: 'none',
			errorMessage: 'Input and output are identical.'
		};
	}

	if (oldString === '') {
		return {
			success: false,
			text: content,
			strategy: 'none',
			errorMessage: 'oldString cannot be empty when editing an existing file.'
		};
	}

	let hasAnyMatch = false;

	for (const { name, replacer } of REPLACER_PIPELINE) {
		for (const search of replacer(content, oldString)) {
			const index = content.indexOf(search);
			if (index === -1) {
				continue;
			}

			hasAnyMatch = true;

			if (isDisproportionateMatch(search, oldString)) {
				return {
					success: false,
					text: content,
					strategy: name,
					errorMessage: 'Refusing replacement: matched span is disproportionately larger than oldString.'
				};
			}

			if (options?.replaceAll) {
				const replaced = content.split(search).join(newString);
				return {
					success: true,
					text: replaced,
					strategy: name,
					matchSpan: { start: index, end: index + search.length, text: newString }
				};
			}

			const lastIndex = content.lastIndexOf(search);
			if (index !== lastIndex) {
				return {
					success: false,
					text: content,
					strategy: name,
					multipleMatches: true,
					errorMessage: 'Multiple matches found. Include more surrounding lines to uniquely identify the section.'
				};
			}

			const replaced = content.substring(0, index) + newString + content.substring(index + search.length);
			return {
				success: true,
				text: replaced,
				strategy: name,
				matchSpan: { start: index, end: index + search.length, text: newString }
			};
		}
	}

	return {
		success: false,
		text: content,
		strategy: 'none',
		errorMessage: hasAnyMatch
			? 'Found multiple ambiguous matches. Provide more surrounding context.'
			: 'Could not find oldString in file. Ensure the context matches the file contents.'
	};
}
