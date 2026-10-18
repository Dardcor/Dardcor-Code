/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type KeyValueSuggestions =
	| string[]
	| Fig.Suggestion[]
	| NonNullable<Fig.Generator['custom']>;

export type Suggestions = KeyValueSuggestions;

export type CacheValue = boolean | 'keys' | 'values';

export interface ValueListInit {
	delimiter?: string;

	values?: KeyValueSuggestions;

	cache?: boolean;

	insertDelimiter?: boolean;

	allowRepeatedValues?: boolean;
}

export interface KeyValueInit {
	separator?: string;

	keys?: KeyValueSuggestions;

	values?: KeyValueSuggestions;

	cache?: CacheValue;

	insertSeparator?: boolean;
}

export interface KeyValueListInit {
	separator?: string;

	delimiter?: string;

	keys?: KeyValueSuggestions;

	values?: KeyValueSuggestions;

	cache?: CacheValue;

	insertSeparator?: boolean;

	insertDelimiter?: boolean;

	allowRepeatedKeys?: boolean;

	allowRepeatedValues?: boolean;
}

const suggestionCache = new Map<KeyValueSuggestions, Fig.Suggestion[]>();

function appendToInsertValue(append: string, suggestions: Fig.Suggestion[]): Fig.Suggestion[] {
	if (append.length === 0) {
		return suggestions;
	}
	return suggestions.map((item) =>
		item.insertValue ? item : { ...item, insertValue: item.name + append }
	);
}

async function kvSuggestionsToFigSuggestions(
	suggestions: KeyValueSuggestions,
	append: string,
	init: Parameters<NonNullable<Fig.Generator['custom']>>
): Promise<Fig.Suggestion[]> {
	if (typeof suggestions === 'function') {
		const out = await suggestions(...init);
		return appendToInsertValue(append, out?.filter(e => !!e) ?? []);
	}
	if (typeof suggestions[0] === 'string') {
		const out = (suggestions as string[]).map((name) => ({ name }));
		return appendToInsertValue(append, out);
	}
	return appendToInsertValue(append, suggestions as Fig.Suggestion[]);
}

async function getSuggestions(
	suggestions: KeyValueSuggestions,
	append: string,
	useSuggestionCache: boolean,
	init: Parameters<NonNullable<Fig.Generator['custom']>>
): Promise<Fig.Suggestion[]> {
	if (useSuggestionCache || Array.isArray(suggestions)) {
		let value = suggestionCache.get(suggestions);
		if (value === undefined) {
			value = await kvSuggestionsToFigSuggestions(suggestions, append, init);
			suggestionCache.set(suggestions, value);
		}
		return value;
	}
	return kvSuggestionsToFigSuggestions(suggestions, append, init);
}

function shouldUseCache(isKey: boolean, cache: CacheValue) {
	if (typeof cache === 'string') {
		return (isKey && cache === 'keys') || (!isKey && cache === 'values');
	}
	return cache;
}

function lastIndexOf(haystack: string, ...needles: readonly string[]) {
	return Math.max(...needles.map((needle) => haystack.lastIndexOf(needle)));
}

function removeRepeatSuggestions(
	alreadyUsed: string[],
	suggestions: readonly Fig.Suggestion[]
): Fig.Suggestion[] {
	const seen = new Set(alreadyUsed);
	return suggestions.filter((suggestion) => {
		if (typeof suggestion.name === 'string') {
			return !seen.has(suggestion.name);
		}
		return !suggestion.name?.some((name) => seen.has(name));
	});
}

export function valueList({
	delimiter = ',',
	values = [],
	cache = false,
	insertDelimiter = false,
	allowRepeatedValues = false,
}: ValueListInit): Fig.Generator {
	return {
		trigger: (newToken, oldToken) =>
			newToken.lastIndexOf(delimiter) !== oldToken.lastIndexOf(delimiter),

		getQueryTerm: (token) => token.slice(token.lastIndexOf(delimiter) + delimiter.length),

		custom: async (...init) => {
			const out = await getSuggestions(values, insertDelimiter ? delimiter : '', cache, init);
			if (allowRepeatedValues) {
				return out;
			}
			const [tokens] = init;
			const valuesInList = tokens[tokens.length - 1]?.split(delimiter);
			return removeRepeatSuggestions(valuesInList, out);
		},
	};
}

export function keyValue({
	separator = '=',
	keys = [],
	values = [],
	cache = false,
	insertSeparator = true,
}: KeyValueInit): Fig.Generator {
	return {
		trigger: (newToken, oldToken) => newToken.indexOf(separator) !== oldToken.indexOf(separator),
		getQueryTerm: (token) => token.slice(token.indexOf(separator) + 1),
		custom: async (...init) => {
			const [tokens] = init;
			const finalToken = tokens[tokens.length - 1];
			const isKey = !finalToken.includes(separator);
			const suggestions = isKey ? keys : values;
			const useCache = shouldUseCache(isKey, cache);
			const append = isKey ? (insertSeparator ? separator : '') : '';
			return getSuggestions(suggestions, append, useCache, init);
		},
	};
}

export function keyValueList({
	separator = '=',
	delimiter = ',',
	keys = [],
	values = [],
	cache = false,
	insertSeparator = true,
	insertDelimiter = false,
	allowRepeatedKeys = false,
	allowRepeatedValues = true,
}: KeyValueListInit): Fig.Generator {
	return {
		trigger: (newToken, oldToken) => {
			const newTokenIdx = lastIndexOf(newToken, separator, delimiter);
			const oldTokenIdx = lastIndexOf(oldToken, separator, delimiter);
			return newTokenIdx !== oldTokenIdx;
		},
		getQueryTerm: (token) => {
			const index = lastIndexOf(token, separator, delimiter);
			return token.slice(index + 1);
		},
		custom: async (...init) => {
			const [tokens] = init;

			const finalToken = tokens[tokens.length - 1];
			const index = lastIndexOf(finalToken, separator, delimiter);
			const isKey = index === -1 || finalToken.slice(index, index + separator.length) !== separator;

			const suggestions = isKey ? keys : values;
			const useCache = shouldUseCache(isKey, cache);
			const append = isKey ? (insertSeparator ? separator : '') : insertDelimiter ? delimiter : '';
			const out = await getSuggestions(suggestions, append, useCache, init);

			if (isKey) {
				if (allowRepeatedKeys) {
					return out;
				}
				const existingKeys = finalToken
					.split(delimiter)
					.map((chunk) => chunk.slice(0, chunk.indexOf(separator)));
				return removeRepeatSuggestions(existingKeys, out);
			}

			if (allowRepeatedValues) {
				return out;
			}
			const existingValues = finalToken
				.split(delimiter)
				.map((chunk) => chunk.slice(chunk.indexOf(separator) + separator.length));
			return removeRepeatSuggestions(existingValues, out);
		},
	};
}
