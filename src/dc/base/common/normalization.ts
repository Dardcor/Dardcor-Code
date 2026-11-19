/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LRUCache } from './map.js';

const nfcCache = new LRUCache<string, string>(10000);
export function normalizeNFC(str: string): string {
	return normalize(str, 'NFC', nfcCache);
}

const nfdCache = new LRUCache<string, string>(10000);
export function normalizeNFD(str: string): string {
	return normalize(str, 'NFD', nfdCache);
}

const nonAsciiCharactersPattern = /[^\u0000-\u0080]/;
function normalize(str: string, form: string, normalizedCache: LRUCache<string, string>): string {
	if (!str) {
		return str;
	}

	const cached = normalizedCache.get(str);
	if (cached) {
		return cached;
	}

	let res: string;
	if (nonAsciiCharactersPattern.test(str)) {
		res = str.normalize(form);
	} else {
		res = str;
	}

	normalizedCache.set(str, res);

	return res;
}

export const tryNormalizeToBase: (str: string) => string = function () {
	const cache = new LRUCache<string, string>(10000);
	const accentsRegex = /[\u0300-\u036f]/g;
	return function (str: string): string {
		const cached = cache.get(str);
		if (cached) {
			return cached;
		}

		const noAccents = normalizeNFD(str).replace(accentsRegex, '');
		const result = (noAccents.length === str.length ? noAccents : str).toLowerCase();
		cache.set(str, result);
		return result;
	};
}();
