/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { safeIntl } from './date.js';
import { Lazy } from './lazy.js';
import { sep } from './path.js';


const intlFileNameCollatorBaseNumeric: Lazy<{ collator: Intl.Collator; collatorIsNumeric: boolean }> = new Lazy(() => {
	const collator = safeIntl.Collator(undefined, { numeric: true, sensitivity: 'base' }).value;
	return {
		collator,
		collatorIsNumeric: collator.resolvedOptions().numeric
	};
});

const intlFileNameCollatorNumeric: Lazy<{ collator: Intl.Collator }> = new Lazy(() => {
	const collator = safeIntl.Collator(undefined, { numeric: true }).value;
	return {
		collator
	};
});

const intlFileNameCollatorNumericCaseInsensitive: Lazy<{ collator: Intl.Collator }> = new Lazy(() => {
	const collator = safeIntl.Collator(undefined, { numeric: true, sensitivity: 'accent' }).value;
	return {
		collator
	};
});

export function compareFileNames(one: string | null, other: string | null, caseSensitive = false): number {
	const a = one || '';
	const b = other || '';
	const result = intlFileNameCollatorBaseNumeric.value.collator.compare(a, b);

	if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && a !== b) {
		return a < b ? -1 : 1;
	}

	return result;
}

export function compareFileNamesDefault(one: string | null, other: string | null): number {
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	one = one || '';
	other = other || '';

	return compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileNamesUpper(one: string | null, other: string | null) {
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	one = one || '';
	other = other || '';

	return compareCaseUpperFirst(one, other) || compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileNamesLower(one: string | null, other: string | null) {
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	one = one || '';
	other = other || '';

	return compareCaseLowerFirst(one, other) || compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileNamesUnicode(one: string | null, other: string | null) {
	one = one || '';
	other = other || '';

	if (one === other) {
		return 0;
	}

	return one < other ? -1 : 1;
}

export function compareFileExtensions(one: string | null, other: string | null): number {
	const [oneName, oneExtension] = extractNameAndExtension(one);
	const [otherName, otherExtension] = extractNameAndExtension(other);

	let result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneExtension, otherExtension);

	if (result === 0) {
		if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && oneExtension !== otherExtension) {
			return oneExtension < otherExtension ? -1 : 1;
		}

		result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneName, otherName);

		if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && oneName !== otherName) {
			return oneName < otherName ? -1 : 1;
		}
	}

	return result;
}

export function compareFileExtensionsDefault(one: string | null, other: string | null): number {
	one = one || '';
	other = other || '';
	const oneExtension = extractExtension(one);
	const otherExtension = extractExtension(other);
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	const collatorNumericCaseInsensitive = intlFileNameCollatorNumericCaseInsensitive.value.collator;

	return compareAndDisambiguateByLength(collatorNumericCaseInsensitive, oneExtension, otherExtension) ||
		compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileExtensionsUpper(one: string | null, other: string | null): number {
	one = one || '';
	other = other || '';
	const oneExtension = extractExtension(one);
	const otherExtension = extractExtension(other);
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	const collatorNumericCaseInsensitive = intlFileNameCollatorNumericCaseInsensitive.value.collator;

	return compareAndDisambiguateByLength(collatorNumericCaseInsensitive, oneExtension, otherExtension) ||
		compareCaseUpperFirst(one, other) ||
		compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileExtensionsLower(one: string | null, other: string | null): number {
	one = one || '';
	other = other || '';
	const oneExtension = extractExtension(one);
	const otherExtension = extractExtension(other);
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	const collatorNumericCaseInsensitive = intlFileNameCollatorNumericCaseInsensitive.value.collator;

	return compareAndDisambiguateByLength(collatorNumericCaseInsensitive, oneExtension, otherExtension) ||
		compareCaseLowerFirst(one, other) ||
		compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function compareFileExtensionsUnicode(one: string | null, other: string | null) {
	one = one || '';
	other = other || '';
	const oneExtension = extractExtension(one).toLowerCase();
	const otherExtension = extractExtension(other).toLowerCase();

	if (oneExtension !== otherExtension) {
		return oneExtension < otherExtension ? -1 : 1;
	}

	if (one !== other) {
		return one < other ? -1 : 1;
	}

	return 0;
}

const FileNameMatch = /^(.*?)(\.([^.]*))?$/;

function extractNameAndExtension(str?: string | null, dotfilesAsNames = false): [string, string] {
	const match = str ? FileNameMatch.exec(str) as Array<string> : ([] as Array<string>);

	let result: [string, string] = [(match && match[1]) || '', (match && match[3]) || ''];

	if (dotfilesAsNames && (!result[0] && result[1] || result[0] && result[0].charAt(0) === '.')) {
		result = [result[0] + '.' + result[1], ''];
	}

	return result;
}

function extractExtension(str?: string | null): string {
	const match = str ? FileNameMatch.exec(str) as Array<string> : ([] as Array<string>);

	return (match && match[1] && match[1].charAt(0) !== '.' && match[3]) || '';
}

function compareAndDisambiguateByLength(collator: Intl.Collator, one: string, other: string) {
	const result = collator.compare(one, other);
	if (result !== 0) {
		return result;
	}

	if (one.length !== other.length) {
		return one.length < other.length ? -1 : 1;
	}

	return 0;
}

function startsWithLower(string: string) {
	const character = string.charAt(0);

	return (character.toLocaleUpperCase() !== character) ? true : false;
}

function startsWithUpper(string: string) {
	const character = string.charAt(0);

	return (character.toLocaleLowerCase() !== character) ? true : false;
}

function compareCaseLowerFirst(one: string, other: string): number {
	if (startsWithLower(one) && startsWithUpper(other)) {
		return -1;
	}
	return (startsWithUpper(one) && startsWithLower(other)) ? 1 : 0;
}

function compareCaseUpperFirst(one: string, other: string): number {
	if (startsWithUpper(one) && startsWithLower(other)) {
		return -1;
	}
	return (startsWithLower(one) && startsWithUpper(other)) ? 1 : 0;
}

function comparePathComponents(one: string, other: string, caseSensitive = false): number {
	if (!caseSensitive) {
		one = one && one.toLowerCase();
		other = other && other.toLowerCase();
	}

	if (one === other) {
		return 0;
	}

	return one < other ? -1 : 1;
}

export function comparePaths(one: string, other: string, caseSensitive = false): number {
	const oneParts = one.split(sep);
	const otherParts = other.split(sep);

	const lastOne = oneParts.length - 1;
	const lastOther = otherParts.length - 1;
	let endOne: boolean, endOther: boolean;

	for (let i = 0; ; i++) {
		endOne = lastOne === i;
		endOther = lastOther === i;

		if (endOne && endOther) {
			return compareFileNames(oneParts[i], otherParts[i], caseSensitive);
		} else if (endOne) {
			return -1;
		} else if (endOther) {
			return 1;
		}

		const result = comparePathComponents(oneParts[i], otherParts[i], caseSensitive);

		if (result !== 0) {
			return result;
		}
	}
}

export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const prefixCompare = compareByPrefix(one, other, lookFor);
	if (prefixCompare) {
		return prefixCompare;
	}

	const elementASuffixMatch = elementAName.endsWith(lookFor);
	const elementBSuffixMatch = elementBName.endsWith(lookFor);
	if (elementASuffixMatch !== elementBSuffixMatch) {
		return elementASuffixMatch ? -1 : 1;
	}

	const r = compareFileNames(elementAName, elementBName);
	if (r !== 0) {
		return r;
	}

	return elementAName.localeCompare(elementBName);
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const elementAPrefixMatch = elementAName.startsWith(lookFor);
	const elementBPrefixMatch = elementBName.startsWith(lookFor);
	if (elementAPrefixMatch !== elementBPrefixMatch) {
		return elementAPrefixMatch ? -1 : 1;
	}

	else if (elementAPrefixMatch && elementBPrefixMatch) {
		if (elementAName.length < elementBName.length) {
			return -1;
		}

		if (elementAName.length > elementBName.length) {
			return 1;
		}
	}

	return 0;
}
