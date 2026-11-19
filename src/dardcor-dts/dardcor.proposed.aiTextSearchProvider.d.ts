/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {
	export interface AITextSearchProvider {
		readonly name?: string;

		provideAITextSearchResults(query: string, options: TextSearchProviderOptions, progress: Progress<TextSearchResult2>, token: CancellationToken): ProviderResult<TextSearchComplete2>;
	}

	export namespace workspace {
		export function registerAITextSearchProvider(scheme: string, provider: AITextSearchProvider): Disposable;
	}
}
