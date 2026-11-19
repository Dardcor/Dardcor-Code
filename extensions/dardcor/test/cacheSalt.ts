/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const CHAT_ML_CACHE_SALT_PER_MODEL: Record<string, string> = {
	'DEFAULT': '2026-04-28T00:00:00Z',
	'dardcor-nes-oct': '2026-02-10T12:14:18.526Z',
};

export const OPENAI_FETCHER_CACHE_SALT: { getByUrl: (url: string) => string } = new class {
	private readonly _cacheSaltByUrl: Record<string, string> = Object.freeze({
		'DEFAULT': '2024-09-25T11:25:00Z',
	});

	getByUrl(url: string): string {
		if (url in this._cacheSaltByUrl) {
			return this._cacheSaltByUrl[url];
		} else {
			return this._cacheSaltByUrl['DEFAULT'];
		}
	}
};

export const CODE_SEARCH_CACHE_SALT = '';

export const CACHING_DIAGNOSTICS_PROVIDER_CACHE_SALT = 4;

export const CLANG_DIAGNOSTICS_PROVIDER_CACHE_SALT = 6;

export const TS_SERVER_DIAGNOSTICS_PROVIDER_CACHE_SALT = 5;

export const PYTHON_VALID_SYNTAX_CACHE_SALT = 2;

export const PYTHON_EXECUTES_WITHOUT_ERRORS = 2;

export const NOTEBOOK_CELL_VALID_CACHE_SALT = 1;


export const CHUNKING_ENDPOINT_CACHE_SALT = '';
