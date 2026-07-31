/**
 * Dardcor Code - String Utilities (Task 59)
 * Mirrors: vs/base/common/strings.ts
 */

const _formatRegexp = /{(\d+)}/g;

export function format(value: string, ...args: any[]): string {
	if (args.length === 0) return value;
	return value.replace(_formatRegexp, (match, group) => {
		const idx = parseInt(group, 10);
		return isNaN(idx) || idx < 0 || idx >= args.length ? match : args[idx];
	});
}

const _format2Regexp = /{([^}]+)}/g;

export function format2(template: string, values: Record<string, unknown>): string {
	if (Object.keys(values).length === 0) return template;
	return template.replace(_format2Regexp, (match, group) => (values[group] ?? match) as string);
}

export function escape(html: string): string {
	return html.replace(/[<>&]/g, (match) => {
		switch (match) {
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '&': return '&amp;';
			default: return match;
		}
	});
}

export function escapeRegExpCharacters(value: string): string {
	return value.replace(/[\\{}*+?|^$.\[\]()]/g, '\\$&');
}

export function count(value: string, substr: string): number {
	let result = 0;
	let index = value.indexOf(substr);
	while (index !== -1) {
		result++;
		index = value.indexOf(substr, index + substr.length);
	}
	return result;
}

export function truncate(value: string, maxLength: number, suffix = '…'): string {
	if (value.length <= maxLength) return value;
	return value.substring(0, maxLength - suffix.length) + suffix;
}

export function trim(value: string, ch: string = ' '): string {
	return ltrim(rtrim(value, ch), ch);
}

export function ltrim(value: string, ch: string = ' '): string {
	let i = 0;
	while (i < value.length && value.charAt(i) === ch) i++;
	return value.substring(i);
}

export function rtrim(value: string, ch: string = ' '): string {
	let i = value.length - 1;
	while (i >= 0 && value.charAt(i) === ch) i--;
	return value.substring(0, i + 1);
}

export function startsWith(haystack: string, needle: string): boolean {
	return haystack.indexOf(needle) === 0;
}

export function endsWith(haystack: string, needle: string): boolean {
	const diff = haystack.length - needle.length;
	if (diff >= 0) {
		return haystack.indexOf(needle, diff) === diff;
	}
	return false;
}

export function equalsIgnoreCase(a: string, b: string): boolean {
	return a.length === b.length && a.toLowerCase() === b.toLowerCase();
}

export function startsWithIgnoreCase(str: string, candidate: string): boolean {
	if (str.length < candidate.length) return false;
	return str.substring(0, candidate.length).toLowerCase() === candidate.toLowerCase();
}

export function endsWithIgnoreCase(str: string, suffix: string): boolean {
	const diff = str.length - suffix.length;
	if (diff < 0) return false;
	return str.substring(diff).toLowerCase() === suffix.toLowerCase();
}

export function commonPrefixLength(a: string, b: string): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
	}
	return len;
}

export function commonSuffixLength(a: string, b: string): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a.charCodeAt(a.length - 1 - i) !== b.charCodeAt(b.length - 1 - i)) return i;
	}
	return len;
}

export function splitLines(str: string): string[] {
	return str.split(/\r\n|\r|\n/);
}

export function isFalsyOrWhitespace(str: string | undefined): boolean {
	if (!str || typeof str !== 'string') return true;
	return str.trim().length === 0;
}

export function pad(n: number, l: number, char: string = '0'): string {
	const str = '' + n;
	const r = [str];
	for (let i = str.length; i < l; i++) {
		r.push(char);
	}
	return r.reverse().join('');
}

export function regExpLeadsToEndlessLoop(regexp: RegExp): boolean {
	if (regexp.source === '^' || regexp.source === '^$' || regexp.source === '$' ||
		regexp.source === '^\\s*$') {
		return false;
	}
	const match = regexp.exec('');
	return !!(match && regexp.lastIndex === 0);
}

export function createRegExp(searchString: string, isRegex: boolean, options?: {
	matchCase?: boolean;
	wholeWord?: boolean;
	multiline?: boolean;
	global?: boolean;
	unicode?: boolean;
}): RegExp {
	if (!searchString) {
		throw new Error('Cannot create regex from empty string');
	}
	if (!isRegex) {
		searchString = escapeRegExpCharacters(searchString);
	}
	if (options?.wholeWord) {
		if (!/\B/.test(searchString.charAt(0))) {
			searchString = '\\b' + searchString;
		}
		if (!/\B/.test(searchString.charAt(searchString.length - 1))) {
			searchString = searchString + '\\b';
		}
	}
	let modifiers = '';
	if (options?.global) modifiers += 'g';
	if (!options?.matchCase) modifiers += 'i';
	if (options?.multiline) modifiers += 'm';
	if (options?.unicode) modifiers += 'u';
	return new RegExp(searchString, modifiers);
}

/**
 * Fuzzy match: returns true if characters in pattern occur in str in order.
 */
export function fuzzyMatch(pattern: string, str: string): boolean {
	const patternLower = pattern.toLowerCase();
	const strLower = str.toLowerCase();
	let pIdx = 0;
	for (let i = 0; i < strLower.length && pIdx < patternLower.length; i++) {
		if (strLower[i] === patternLower[pIdx]) pIdx++;
	}
	return pIdx === patternLower.length;
}

export function repeat(s: string, count: number): string {
	let result = '';
	for (let i = 0; i < count; i++) result += s;
	return result;
}

export function isHighSurrogate(charCode: number): boolean {
	return 0xD800 <= charCode && charCode <= 0xDBFF;
}

export function isLowSurrogate(charCode: number): boolean {
	return 0xDC00 <= charCode && charCode <= 0xDFFF;
}

export function getLeadingWhitespace(str: string, start: number = 0, end: number = str.length): string {
	for (let i = start; i < end; i++) {
		const ch = str.charCodeAt(i);
		if (ch !== 32 /* Space */ && ch !== 9 /* Tab */) {
			return str.substring(start, i);
		}
	}
	return str.substring(start, end);
}
