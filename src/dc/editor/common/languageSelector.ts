/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRelativePattern, match as matchGlobPattern } from '../../base/common/glob.js';
import { URI } from '../../base/common/uri.js';
import { normalize } from '../../base/common/path.js';

export interface LanguageFilter {
	readonly language?: string;
	readonly scheme?: string;
	readonly pattern?: string | IRelativePattern;
	readonly notebookType?: string;
	readonly hasAccessToAllModels?: boolean;
	readonly exclusive?: boolean;

	readonly isBuiltin?: boolean;
}

export type LanguageSelector = string | LanguageFilter | ReadonlyArray<string | LanguageFilter>;

export function score(selector: LanguageSelector | undefined, candidateUri: URI, candidateLanguage: string, candidateIsSynchronized: boolean, candidateNotebookUri: URI | undefined, candidateNotebookType: string | undefined): number {

	if (Array.isArray(selector)) {
		let ret = 0;
		for (const filter of selector) {
			const value = score(filter, candidateUri, candidateLanguage, candidateIsSynchronized, candidateNotebookUri, candidateNotebookType);
			if (value === 10) {
				return value;
			}
			if (value > ret) {
				ret = value;
			}
		}
		return ret;

	} else if (typeof selector === 'string') {

		if (!candidateIsSynchronized) {
			return 0;
		}

		if (selector === '*') {
			return 5;
		} else if (selector === candidateLanguage) {
			return 10;
		} else {
			return 0;
		}

	} else if (selector) {
		const { language, pattern, scheme, hasAccessToAllModels, notebookType } = selector as LanguageFilter;

		if (!candidateIsSynchronized && !hasAccessToAllModels) {
			return 0;
		}

		if (notebookType && candidateNotebookUri) {
			candidateUri = candidateNotebookUri;
		}

		let ret = 0;

		if (scheme) {
			if (scheme === candidateUri.scheme) {
				ret = 10;
			} else if (scheme === '*') {
				ret = 5;
			} else {
				return 0;
			}
		}

		if (language) {
			if (language === candidateLanguage) {
				ret = 10;
			} else if (language === '*') {
				ret = Math.max(ret, 5);
			} else {
				return 0;
			}
		}

		if (notebookType) {
			if (notebookType === candidateNotebookType) {
				ret = 10;
			} else if (notebookType === '*' && candidateNotebookType !== undefined) {
				ret = Math.max(ret, 5);
			} else {
				return 0;
			}
		}

		if (pattern) {
			let normalizedPattern: string | IRelativePattern;
			if (typeof pattern === 'string') {
				normalizedPattern = pattern;
			} else {
				normalizedPattern = { ...pattern, base: normalize(pattern.base) };
			}

			if (normalizedPattern === candidateUri.fsPath || matchGlobPattern(normalizedPattern, candidateUri.fsPath)) {
				ret = 10;
			} else {
				return 0;
			}
		}

		return ret;

	} else {
		return 0;
	}
}


export function targetsNotebooks(selector: LanguageSelector): boolean {
	if (typeof selector === 'string') {
		return false;
	} else if (Array.isArray(selector)) {
		return selector.some(targetsNotebooks);
	} else {
		return !!(<LanguageFilter>selector).notebookType;
	}
}

export function selectLanguageIds(selector: LanguageSelector, into: Set<string>): void {
	if (typeof selector === 'string') {
		into.add(selector);
	} else if (Array.isArray(selector)) {
		for (const item of selector) {
			selectLanguageIds(item, into);
		}
	} else {
		const language = (<LanguageFilter>selector).language;
		if (language) {
			into.add(language);
		}
	}
}
