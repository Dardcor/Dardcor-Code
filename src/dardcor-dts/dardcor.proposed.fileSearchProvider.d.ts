/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface FileSearchQuery {
		pattern: string;
	}

	export interface FileSearchOptions extends SearchOptions {
		maxResults?: number;

		session?: CancellationToken;
	}

	export interface FileSearchProvider {
		provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): ProviderResult<Uri[]>;
	}

	export namespace workspace {
		export function registerFileSearchProvider(scheme: string, provider: FileSearchProvider): Disposable;
	}
}
