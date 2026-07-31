/**
 * Dardcor Code - Word Boundary Parser (Task 207)
 * Mirrors: vs/editor/common/core/wordHelper.ts (`getWordAtPosition`)
 */

export interface IWordAtPosition {
	readonly word: string;
	readonly startColumn: number;
	readonly endColumn: number;
}

export const DEFAULT_WORD_REGEXP = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\$\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;

export function getWordAtPosition(lineContent: string, column: number, regex = DEFAULT_WORD_REGEXP): IWordAtPosition | null {
	regex.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(lineContent)) !== null) {
		const start = match.index + 1; // 1-indexed
		const end = start + match[0].length;

		if (start <= column && column <= end) {
			return {
				word: match[0],
				startColumn: start,
				endColumn: end,
			};
		}
	}

	return null;
}
