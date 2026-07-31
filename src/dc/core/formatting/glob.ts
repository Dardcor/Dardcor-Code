/**
 * Dardcor Code - Glob Pattern Matcher (Task 72)
 * Mirrors: vs/base/common/glob.ts
 */

export const GLOBSTAR = '**';
export const GLOB_SPLIT = '/';

export interface IRelativePattern {
	readonly base: string;
	readonly pattern: string;
}

export function match(pattern: string, path: string): boolean {
	return globToRegExp(pattern).test(normalizePath(path));
}

export function parse(expression: Record<string, boolean>): (path: string) => boolean {
	const patterns = Object.keys(expression).filter(k => expression[k]);
	const matchers = patterns.map(p => globToRegExp(p));
	return (path: string) => {
		const normalized = normalizePath(path);
		return matchers.some(m => m.test(normalized));
	};
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/');
}

function globToRegExp(pattern: string): RegExp {
	let regStr = '';
	let inGroup = false;
	const len = pattern.length;
	for (let i = 0; i < len; i++) {
		const ch = pattern[i];
		switch (ch) {
			case '*':
				if (i + 1 < len && pattern[i + 1] === '*') {
					// **
					if (i + 2 < len && pattern[i + 2] === '/') {
						regStr += '(?:[^/]*(?:\\/|$))*';
						i += 2;
					} else {
						regStr += '.*';
						i += 1;
					}
				} else {
					regStr += '[^/]*';
				}
				break;
			case '?':
				regStr += '[^/]';
				break;
			case '{':
				inGroup = true;
				regStr += '(?:';
				break;
			case '}':
				inGroup = false;
				regStr += ')';
				break;
			case ',':
				regStr += inGroup ? '|' : ',';
				break;
			case '.': case '+': case '^': case '$': case '|':
			case '(': case ')': case '[': case ']': case '\\':
				regStr += '\\' + ch;
				break;
			default:
				regStr += ch;
		}
	}
	return new RegExp('^' + regStr + '$', 'i');
}

export function isRelativePattern(obj: any): obj is IRelativePattern {
	return obj && typeof obj.base === 'string' && typeof obj.pattern === 'string';
}

export function splitGlobAware(pattern: string, splitChar: string): string[] {
	if (!pattern) return [];
	const segments: string[] = [];
	let inBraces = false;
	let inBrackets = false;
	let curVal = '';
	for (const char of pattern) {
		switch (char) {
			case splitChar:
				if (!inBraces && !inBrackets) {
					segments.push(curVal);
					curVal = '';
					continue;
				}
				break;
			case '{': inBraces = true; break;
			case '}': inBraces = false; break;
			case '[': inBrackets = true; break;
			case ']': inBrackets = false; break;
		}
		curVal += char;
	}
	if (curVal) segments.push(curVal);
	return segments;
}

export function getBasenameTerms(pattern: string): string[] {
	return splitGlobAware(pattern, '/').filter(s => s !== GLOBSTAR);
}
