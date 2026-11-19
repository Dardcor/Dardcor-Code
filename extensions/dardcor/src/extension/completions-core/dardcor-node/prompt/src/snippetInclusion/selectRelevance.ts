/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentInfo, DocumentInfoWithOffset, SimilarFileInfo } from '../prompt';
import { LRUCache } from '../../../../../../util/common/cache';
import { CursorContextInfo } from './cursorContext';
import { SnippetProviderType, SnippetSemantics, SnippetWithProviderInfo } from './snippets';

export interface ScoredSnippetMarker {
	score: number;
	startLine: number;
	endLine: number;
}

export interface ScoredSnippet extends ScoredSnippetMarker {
	snippet: string;
	relativePath?: string;
	uri?: string;
	isFromRelatedFile?: boolean;
}

export enum SortOptions {
	Ascending = 'ascending',
	Descending = 'descending',
	None = 'none',
}

class Tokenizer {
	private readonly stopsForLanguage: Set<string>;
	constructor(doc: DocumentInfo) {
		this.stopsForLanguage = SPECIFIC_STOPS.get(doc.languageId) ?? GENERIC_STOPS;
	}
	tokenize(a: string): Set<string> {
		return new Set<string>(splitIntoWords(a).filter(x => !this.stopsForLanguage.has(x)));
	}
}

const WINDOWED_TOKEN_SET_CACHE = new LRUCache<Set<string>[]>(20);

export abstract class WindowedMatcher {
	protected referenceDoc: DocumentInfoWithOffset;
	protected tokenizer: Tokenizer;

	protected abstract id(): string;
	protected abstract similarityScore(a: Set<string>, b: Set<string>): number;
	protected abstract getWindowsDelineations(lines: string[]): [number, number][];

	protected abstract _getCursorContextInfo(referenceDoc: DocumentInfoWithOffset): CursorContextInfo;

	protected constructor(referenceDoc: DocumentInfoWithOffset) {
		this.referenceDoc = referenceDoc;
		this.tokenizer = new Tokenizer(referenceDoc);
	}

	protected referenceTokensCache: Set<string> | undefined;
	get referenceTokens(): Promise<Set<string>> {
		return Promise.resolve(this.createReferenceTokens());
	}

	private createReferenceTokens(): Set<string> {
		return (this.referenceTokensCache ??= this.tokenizer.tokenize(
			this._getCursorContextInfo(this.referenceDoc).context
		));
	}

	sortScoredSnippets(snippets: ScoredSnippetMarker[], sortOption = SortOptions.Descending): ScoredSnippetMarker[] {
		return sortOption === SortOptions.Ascending
			? snippets.sort((snippetA, snippetB) => (snippetA.score > snippetB.score ? 1 : -1))
			: sortOption === SortOptions.Descending
				? snippets.sort((snippetA, snippetB) => (snippetA.score > snippetB.score ? -1 : 1))
				: snippets;
	}
	async retrieveAllSnippets(
		objectDoc: SimilarFileInfo,
		sortOption = SortOptions.Descending
	): Promise<ScoredSnippetMarker[]> {
		const snippets: ScoredSnippetMarker[] = [];

		if (objectDoc.source.length === 0 || (await this.referenceTokens).size === 0) {
			return snippets;
		}

		const lines = objectDoc.source.split('\n');
		const key = this.id() + ':' + objectDoc.source;
		const tokensInWindows = WINDOWED_TOKEN_SET_CACHE.get(key) ?? [];
		const needToComputeTokens = tokensInWindows.length === 0;
		const tokenizedLines = needToComputeTokens ? lines.map(l => this.tokenizer.tokenize(l), this.tokenizer) : [];

		for (const [index, [startLine, endLine]] of this.getWindowsDelineations(lines).entries()) {
			if (needToComputeTokens) {
				const tokensInWindow = new Set<string>();
				tokenizedLines
					.slice(startLine, endLine)
					.forEach(x => x.forEach(s => tokensInWindow.add(s), tokensInWindow));
				tokensInWindows.push(tokensInWindow);
			}
			const tokensInWindow = tokensInWindows[index];
			const score = this.similarityScore(tokensInWindow, await this.referenceTokens);

			if (snippets.length && startLine > 0 && snippets[snippets.length - 1].endLine > startLine) {
				if (snippets[snippets.length - 1].score < score) {
					snippets[snippets.length - 1].score = score;
					snippets[snippets.length - 1].startLine = startLine;
					snippets[snippets.length - 1].endLine = endLine;
				}
				continue;
			}

			snippets.push({
				score,
				startLine,
				endLine,
			});
		}

		if (needToComputeTokens) {
			WINDOWED_TOKEN_SET_CACHE.put(key, tokensInWindows);
		}

		return this.sortScoredSnippets(snippets, sortOption);
	}

	findMatches(objectDoc: SimilarFileInfo, maxSnippetsPerFile: number): Promise<SnippetWithProviderInfo[]> {
		const snippet = this.findBestMatch(objectDoc, maxSnippetsPerFile);
		return snippet;
	}

	async findBestMatch(objectDoc: SimilarFileInfo, maxSnippetsPerFile: number): Promise<SnippetWithProviderInfo[]> {
		if (objectDoc.source.length === 0 || (await this.referenceTokens).size === 0) {
			return [];
		}
		const lines = objectDoc.source.split('\n');
		const snippets = await this.retrieveAllSnippets(objectDoc, SortOptions.Descending);

		if (snippets.length === 0) {
			return [];
		}

		const bestSnippets: SnippetWithProviderInfo[] = [];

		for (let i = 0; i < snippets.length && i < maxSnippetsPerFile; i++) {
			if (snippets[i].score !== 0) {
				const snippetCode = lines.slice(snippets[i].startLine, snippets[i].endLine).join('\n');
				bestSnippets.push({
					snippet: snippetCode,
					semantics: SnippetSemantics.Snippet,
					provider: SnippetProviderType.SimilarFiles,
					...snippets[i],
				});
			}
		}

		return bestSnippets;
	}
}

export function splitIntoWords(a: string): string[] {
	return a.split(/[^a-zA-Z0-9]/).filter(x => x.length > 0);
}

const ENGLISH_STOPS = new Set([
	'we',
	'our',
	'you',
	'it',
	'its',
	'they',
	'them',
	'their',
	'this',
	'that',
	'these',
	'those',
	'is',
	'are',
	'was',
	'were',
	'be',
	'been',
	'being',
	'have',
	'has',
	'had',
	'having',
	'do',
	'does',
	'did',
	'doing',
	'can',
	'don',
	't',
	's',
	'will',
	'would',
	'should',
	'what',
	'which',
	'who',
	'when',
	'where',
	'why',
	'how',
	'a',
	'an',
	'the',
	'and',
	'or',
	'not',
	'no',
	'but',
	'because',
	'as',
	'until',
	'again',
	'further',
	'then',
	'once',
	'here',
	'there',
	'all',
	'any',
	'both',
	'each',
	'few',
	'more',
	'most',
	'other',
	'some',
	'such',
	'above',
	'below',
	'to',
	'during',
	'before',
	'after',
	'of',
	'at',
	'by',
	'about',
	'between',
	'into',
	'through',
	'from',
	'up',
	'down',
	'in',
	'out',
	'on',
	'off',
	'over',
	'under',
	'only',
	'own',
	'same',
	'so',
	'than',
	'too',
	'very',
	'just',
	'now',
]);

const GENERIC_STOPS = new Set([
	'if',
	'then',
	'else',
	'for',
	'while',
	'with',
	'def',
	'function',
	'return',
	'TODO',
	'import',
	'try',
	'catch',
	'raise',
	'finally',
	'repeat',
	'switch',
	'case',
	'match',
	'assert',
	'continue',
	'break',
	'const',
	'class',
	'enum',
	'struct',
	'static',
	'new',
	'super',
	'this',
	'var',
	...ENGLISH_STOPS,
]);

const SPECIFIC_STOPS: Map<string, Set<string>> = new Map([
]);
