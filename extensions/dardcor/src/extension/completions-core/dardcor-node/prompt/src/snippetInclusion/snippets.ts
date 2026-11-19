/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScoredSnippet } from './selectRelevance';

export enum SnippetProviderType {
	SimilarFiles = 'similar-files',
	Path = 'path',
}

export enum SnippetSemantics {
	Function = 'function',
	Snippet = 'snippet',
	Snippets = 'snippets',
	Variable = 'variable',
	Parameter = 'parameter',
	Method = 'method',
	Class = 'class',
	Module = 'module',
	Alias = 'alias',
	Enum = 'enum member',
	Interface = 'interface',
}

export interface SnippetWithProviderInfo extends ScoredSnippet {
	provider: SnippetProviderType;
	semantics: SnippetSemantics;
}

type SnippetToAnnounce = Pick<SnippetWithProviderInfo, 'snippet' | 'semantics' | 'relativePath'>;

const snippetSemanticsToString: { [key in SnippetSemantics]: string } = {
	[SnippetSemantics.Function]: 'function',
	[SnippetSemantics.Snippet]: 'snippet',
	[SnippetSemantics.Snippets]: 'snippets',
	[SnippetSemantics.Variable]: 'variable',
	[SnippetSemantics.Parameter]: 'parameter',
	[SnippetSemantics.Method]: 'method',
	[SnippetSemantics.Class]: 'class',
	[SnippetSemantics.Module]: 'module',
	[SnippetSemantics.Alias]: 'alias',
	[SnippetSemantics.Enum]: 'enum member',
	[SnippetSemantics.Interface]: 'interface',
};

export function announceSnippet(snippet: SnippetToAnnounce) {
	const semantics = snippetSemanticsToString[snippet.semantics];
	const pluralizedSemantics = [SnippetSemantics.Snippets].includes(snippet.semantics) ? 'these' : 'this';
	const headline = snippet.relativePath
		? `Compare ${pluralizedSemantics} ${semantics} from ${snippet.relativePath}:`
		: `Compare ${pluralizedSemantics} ${semantics}:`;
	return { headline, snippet: snippet.snippet };
}
