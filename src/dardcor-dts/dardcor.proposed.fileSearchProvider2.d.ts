/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {


	export interface FileSearchProviderOptions {
		folderOptions: {
			folder: Uri;

			includes: string[];

			excludes: GlobPattern[];

			followSymlinks: boolean;

			useIgnoreFiles: {
				local: boolean;
				parent: boolean;
				/**
				 * Use global ignore files. If set, `local` in {@link FileSearchProviderOptions.useIgnoreFiles} should also be `true`.
				 */
				global: boolean;
			};
		}[];

		session: object;

		maxResults: number;
	}

	export interface FileSearchProvider2 {
		provideFileSearchResults(pattern: string, options: FileSearchProviderOptions, token: CancellationToken): ProviderResult<Uri[]>;
	}

	export namespace workspace {
		export function registerFileSearchProvider2(scheme: string, provider: FileSearchProvider2): Disposable;
	}
}
