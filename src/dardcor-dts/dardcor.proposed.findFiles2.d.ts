/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'vscode' {

	export interface FindFiles2Options {
		exclude?: GlobPattern[];

		useExcludeSettings?: ExcludeSettingOptions;

		maxResults?: number;

		useIgnoreFiles?: {
			local?: boolean;
			parent?: boolean;
			/**
			 * Use global ignore files. When set to `true`, {@link FindFiles2Options.useIgnoreFiles.local} must also be `true`.
			 * May default to `search.useGlobalIgnoreFiles` setting if not set.
			 */
			global?: boolean;
		};

		followSymlinks?: boolean;

		caseInsensitive?: boolean;
	}

	export enum ExcludeSettingOptions {
		None = 1,
		FilesExclude = 2,
		SearchAndFilesExclude = 3
	}

	export namespace workspace {
		export function findFiles2(filePattern: GlobPattern[], options?: FindFiles2Options, token?: CancellationToken): Thenable<Uri[]>;
	}
}
