/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentInfoWithOffset, SimilarFileInfo } from '../prompt';
import { FixedWindowSizeJaccardMatcher } from './jaccardMatching';
import { SnippetWithProviderInfo } from './snippets';
import { BlockTokenSubsetMatcher } from './subsetMatching';

const DEFAULT_SNIPPET_THRESHOLD = 0.0;
const DEFAULT_SNIPPET_WINDOW_SIZE = 60;
const DEFAULT_MAX_TOP_SNIPPETS = 4;
const DEFAULT_MAX_SNIPPETS_PER_FILE = 1;
const DEFAULT_MAX_NUMBER_OF_FILES = 20;
const DEFAULT_MAX_CHARACTERS_PER_FILE = 10000;

export interface SimilarFilesOptions {
	snippetLength: number;
	threshold: number;
	maxTopSnippets: number;
	maxCharPerFile: number;
	maxNumberOfFiles: number;
	maxSnippetsPerFile: number;
	useSubsetMatching?: boolean;
}

export const defaultSimilarFilesOptions: SimilarFilesOptions = {
	snippetLength: DEFAULT_SNIPPET_WINDOW_SIZE,
	threshold: DEFAULT_SNIPPET_THRESHOLD,
	maxTopSnippets: DEFAULT_MAX_TOP_SNIPPETS,
	maxCharPerFile: DEFAULT_MAX_CHARACTERS_PER_FILE,
	maxNumberOfFiles: DEFAULT_MAX_NUMBER_OF_FILES,
	maxSnippetsPerFile: DEFAULT_MAX_SNIPPETS_PER_FILE,
	useSubsetMatching: false,
};

export const conservativeFilesOptions: SimilarFilesOptions = {
	snippetLength: 10,
	threshold: 0.3,
	maxTopSnippets: 1,
	maxCharPerFile: DEFAULT_MAX_CHARACTERS_PER_FILE,
	maxNumberOfFiles: DEFAULT_MAX_NUMBER_OF_FILES,
	maxSnippetsPerFile: 1,
};

export const nullSimilarFilesOptions: SimilarFilesOptions = {
	snippetLength: 0,
	threshold: 1,
	maxTopSnippets: 0,
	maxCharPerFile: 0,
	maxNumberOfFiles: 0,
	maxSnippetsPerFile: 0,
};

export const defaultCppSimilarFilesOptions: SimilarFilesOptions = {
	snippetLength: 60,
	threshold: 0.0,
	maxTopSnippets: 16,
	maxCharPerFile: 100000,
	maxNumberOfFiles: 200,
	maxSnippetsPerFile: 4,
};

function getMatcher(doc: DocumentInfoWithOffset, selection: SimilarFilesOptions) {
	const matcherFactory = selection.useSubsetMatching
		? BlockTokenSubsetMatcher.FACTORY(selection.snippetLength)
		: FixedWindowSizeJaccardMatcher.FACTORY(selection.snippetLength);
	return matcherFactory.to(doc);
}

export type SnippetWithSourceInfo = SnippetWithProviderInfo & { uri: string; isFromRelatedFile: boolean };

export async function getSimilarSnippets(
	doc: DocumentInfoWithOffset,
	similarFiles: SimilarFileInfo[],
	options: SimilarFilesOptions
): Promise<SnippetWithSourceInfo[]> {
	const matcher = getMatcher(doc, options);
	if (options.maxTopSnippets === 0) {
		return [];
	}

	const snippets = (
		await similarFiles
			.filter(similarFile => similarFile.source.length < options.maxCharPerFile && similarFile.source.length > 0)
			.slice(0, options.maxNumberOfFiles)
			.reduce(
				async (
					acc,
					similarFile
				) =>
					(await acc).concat(
						(await matcher.findMatches(similarFile, options.maxSnippetsPerFile)).map(snippet => ({
							...snippet,
							relativePath: similarFile.relativePath,
							uri: similarFile.uri,
							isFromRelatedFile: similarFile.isFromRelatedFile ?? false,
						}))
					),
				Promise.resolve([] as SnippetWithSourceInfo[])
			)
	)
		.filter(
			similarFile =>
				similarFile.score &&
				similarFile.snippet &&
				similarFile.score > options.threshold
		)
		.sort((a, b) => a.score - b.score)
		.slice(-options.maxTopSnippets);
	return snippets;
}
