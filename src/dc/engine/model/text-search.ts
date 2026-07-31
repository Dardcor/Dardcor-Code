/**
 * Dardcor Code - Regex Document Search Engine (Task 255)
 * Mirrors: vs/editor/contrib/find/findModel.ts
 */

import { ITextModel, IRange, Range } from './text-model';
import { TextBuffer } from './text-buffer';
import { escapeRegExpCharacters } from '../../core/types/strings';

export interface ISearchQuery {
	readonly searchString: string;
	readonly isRegex: boolean;
	readonly caseSensitive: boolean;
	readonly wholeWord: boolean;
}

export interface ISearchMatch {
	readonly range: Range;
	readonly matchText: string;
}

export class TextSearch {
	public static buildSearchRegex(query: ISearchQuery): RegExp {
		let source = query.isRegex ? query.searchString : escapeRegExpCharacters(query.searchString);
		if (query.wholeWord) {
			source = `\\b${source}\\b`;
		}
		return new RegExp(source, query.caseSensitive ? 'g' : 'gi');
	}

	public static findMatchesInText(text: string, query: ISearchQuery, fromOffset = 0, limit = Number.MAX_SAFE_INTEGER): ISearchMatch[] {
		const buffer = TextBuffer.fromString(text);
		const regex = TextSearch.buildSearchRegex(query);
		return buffer.searchRegex(regex, fromOffset, limit);
	}

	public static findMatchesInModel(model: ITextModel, query: ISearchQuery, fromPosition?: IRange): ISearchMatch[] {
		const text = model.getValue();
		const fromOffset = fromPosition ? TextSearch.positionToOffset(text, fromPosition) : 0;
		return TextSearch.findMatchesInText(text, query, fromOffset);
	}

	public static findNextMatch(model: ITextModel, query: ISearchQuery, fromPosition: IRange): ISearchMatch | null {
		const matches = TextSearch.findMatchesInModel(model, query, fromPosition);
		if (matches.length === 0) {
			return null;
		}
		const startOffset = TextSearch.positionToOffset(model.getValue(), fromPosition);
		for (const match of matches) {
			const matchOffset = TextSearch.positionToOffset(model.getValue(), match.range);
			if (matchOffset >= startOffset) {
				return match;
			}
		}
		return matches[0];
	}

	public static findPreviousMatch(model: ITextModel, query: ISearchQuery, fromPosition: IRange): ISearchMatch | null {
		const matches = TextSearch.findMatchesInModel(model, query);
		if (matches.length === 0) {
			return null;
		}
		const endOffset = TextSearch.positionToOffset(model.getValue(), {
			startLineNumber: fromPosition.endLineNumber,
			startColumn: fromPosition.endColumn,
			endLineNumber: fromPosition.endLineNumber,
			endColumn: fromPosition.endColumn,
		});
		for (let i = matches.length - 1; i >= 0; i--) {
			const matchOffset = TextSearch.positionToOffset(model.getValue(), matches[i].range);
			if (matchOffset < endOffset) {
				return matches[i];
			}
		}
		return matches[matches.length - 1];
	}

	public static replaceMatch(model: ITextModel, match: ISearchMatch, replacement: string): boolean {
		const text = model.getValue();
		const startOffset = TextSearch.positionToOffset(text, match.range);
		const endOffset = TextSearch.positionToOffset(text, {
			startLineNumber: match.range.endLineNumber,
			startColumn: match.range.endColumn,
			endLineNumber: match.range.endLineNumber,
			endColumn: match.range.endColumn,
		});
		model.setValue(text.substring(0, startOffset) + replacement + text.substring(endOffset));
		return true;
	}

	public static replaceAll(model: ITextModel, query: ISearchQuery, replacement: string, preserveCase = false): number {
		const text = model.getValue();
		const regex = TextSearch.buildSearchRegex(query);
		regex.lastIndex = 0;
		let count = 0;
		const result = text.replace(regex, (match) => {
			count++;
			if (preserveCase) {
				return TextSearch.preserveCaseReplacement(match, replacement);
			}
			return replacement;
		});
		model.setValue(result);
		return count;
	}

	private static preserveCaseReplacement(match: string, replacement: string): string {
		if (match === match.toUpperCase()) {
			return replacement.toUpperCase();
		}
		if (match.charAt(0) === match.charAt(0).toUpperCase()) {
			return replacement.charAt(0).toUpperCase() + replacement.substring(1);
		}
		return replacement.toLowerCase();
	}

	private static positionToOffset(text: string, range: IRange): number {
		const lines = text.split(/\r?\n/);
		let offset = 0;
		for (let i = 1; i < range.startLineNumber; i++) {
			offset += (lines[i - 1] || '').length + 1;
		}
		return offset + (range.startColumn - 1);
	}
}
