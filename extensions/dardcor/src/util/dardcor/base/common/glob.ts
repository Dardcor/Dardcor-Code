/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from './arrays';
import { isThenable } from './async';
import { CharCode } from './charCode';
import { isEqualOrParent } from './extpath';
import { LRUCache } from './map';
import { basename, extname, posix, sep } from './path';
import { isLinux } from './platform';
import { endsWithIgnoreCase, equalsIgnoreCase, escapeRegExpCharacters, ltrim } from './strings';

export interface IRelativePattern {

	readonly base: string;

	readonly pattern: string;
}

export interface IExpression {
	[pattern: string]: boolean | SiblingClause;
}

export function getEmptyExpression(): IExpression {
	return Object.create(null);
}

interface SiblingClause {
	when: string;
}

export const GLOBSTAR = '**';
export const GLOB_SPLIT = '/';

const PATH_REGEX = '[/\\\\]';
const NO_PATH_REGEX = '[^/\\\\]';
const ALL_FORWARD_SLASHES = /\//g;

function starsToRegExp(starCount: number, isLastPattern?: boolean): string {
	switch (starCount) {
		case 0:
			return '';
		case 1:
			return `${NO_PATH_REGEX}*?`;
		default:
			return `(?:${PATH_REGEX}|${NO_PATH_REGEX}+${PATH_REGEX}${isLastPattern ? `|${PATH_REGEX}${NO_PATH_REGEX}+` : ''})*?`;
	}
}

export function splitGlobAware(pattern: string, splitChar: string): string[] {
	if (!pattern) {
		return [];
	}

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
			case '{':
				inBraces = true;
				break;
			case '}':
				inBraces = false;
				break;
			case '[':
				inBrackets = true;
				break;
			case ']':
				inBrackets = false;
				break;
		}

		curVal += char;
	}

	if (curVal) {
		segments.push(curVal);
	}

	return segments;
}

function parseRegExp(pattern: string): string {
	if (!pattern) {
		return '';
	}

	let regEx = '';

	const segments = splitGlobAware(pattern, GLOB_SPLIT);

	if (segments.every(segment => segment === GLOBSTAR)) {
		regEx = '.*';
	}

	else {
		let previousSegmentWasGlobStar = false;
		segments.forEach((segment, index) => {

			if (segment === GLOBSTAR) {

				if (previousSegmentWasGlobStar) {
					return;
				}

				regEx += starsToRegExp(2, index === segments.length - 1);
			}

			else {

				let inBraces = false;
				let braceVal = '';

				let inBrackets = false;
				let bracketVal = '';

				for (const char of segment) {

					if (char !== '}' && inBraces) {
						braceVal += char;
						continue;
					}

					if (inBrackets && (char !== ']' || !bracketVal) ) {
						let res: string;

						if (char === '-') {
							res = char;
						}

						else if ((char === '^' || char === '!') && !bracketVal) {
							res = '^';
						}

						else if (char === GLOB_SPLIT) {
							res = '';
						}

						else {
							res = escapeRegExpCharacters(char);
						}

						bracketVal += res;
						continue;
					}

					switch (char) {
						case '{':
							inBraces = true;
							continue;

						case '[':
							inBrackets = true;
							continue;

						case '}': {
							const choices = splitGlobAware(braceVal, ',');

							const braceRegExp = `(?:${choices.map(choice => parseRegExp(choice)).join('|')})`;

							regEx += braceRegExp;

							inBraces = false;
							braceVal = '';

							break;
						}

						case ']': {
							regEx += ('[' + bracketVal + ']');

							inBrackets = false;
							bracketVal = '';

							break;
						}

						case '?':
							regEx += NO_PATH_REGEX;
							continue;

						case '*':
							regEx += starsToRegExp(1);
							continue;

						default:
							regEx += escapeRegExpCharacters(char);
					}
				}

				if (
					index < segments.length - 1 &&
					(
						segments[index + 1] !== GLOBSTAR ||
						index + 2 < segments.length
					)
				) {
					regEx += PATH_REGEX;
				}
			}

			previousSegmentWasGlobStar = (segment === GLOBSTAR);
		});
	}

	return regEx;
}

const T1 = /^\*\*\/\*\.[\w\.-]+$/;
const T2 = /^\*\*\/([\w\.-]+)\/?$/;
const T3 = /^{\*\*\/\*?[\w\.-]+\/?(,\*\*\/\*?[\w\.-]+\/?)*}$/;
const T3_2 = /^{\*\*\/\*?[\w\.-]+(\/(\*\*)?)?(,\*\*\/\*?[\w\.-]+(\/(\*\*)?)?)*}$/;
const T4 = /^\*\*((\/[\w\.-]+)+)\/?$/;
const T5 = /^([\w\.-]+(\/[\w\.-]+)*)\/?$/;

export type ParsedPattern = (path: string, basename?: string) => boolean;

export type ParsedExpression = (path: string, basename?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) => string | null | Promise<string | null> ;

export interface IGlobOptions {

	trimForExclusions?: boolean;

	ignoreCase?: boolean;
}

interface IGlobOptionsInternal extends IGlobOptions {
	equals: (a: string, b: string) => boolean;
	endsWith: (str: string, candidate: string) => boolean;
	isEqualOrParent: (base: string, candidate: string) => boolean;
}

interface ParsedStringPattern {
	(path: string, basename?: string): string | null | Promise<string | null> ;
	basenames?: string[];
	patterns?: string[];
	allBasenames?: string[];
	allPaths?: string[];
}

interface ParsedExpressionPattern {
	(path: string, basename?: string, name?: string, hasSibling?: (name: string) => boolean | Promise<boolean>): string | null | Promise<string | null> ;
	requiresSiblings?: boolean;
	allBasenames?: string[];
	allPaths?: string[];
}

const CACHE = new LRUCache<string, ParsedStringPattern>(10000);

const FALSE = function () {
	return false;
};

const NULL = function (): string | null {
	return null;
};

export function isEmptyPattern(pattern: ParsedPattern | ParsedExpression): pattern is (typeof FALSE | typeof NULL) {
	if (pattern === FALSE) {
		return true;
	}

	if (pattern === NULL) {
		return true;
	}

	return false;
}

function parsePattern(arg1: string | IRelativePattern, options: IGlobOptions): ParsedStringPattern {
	if (!arg1) {
		return NULL;
	}

	let pattern: string;
	if (typeof arg1 !== 'string') {
		pattern = arg1.pattern;
	} else {
		pattern = arg1;
	}

	pattern = pattern.trim();

	const ignoreCase = options.ignoreCase ?? false;
	const internalOptions = {
		...options,
		equals: ignoreCase ? equalsIgnoreCase : (a: string, b: string) => a === b,
		endsWith: ignoreCase ? endsWithIgnoreCase : (str: string, candidate: string) => str.endsWith(candidate),
		isEqualOrParent: (base: string, candidate: string) => isEqualOrParent(base, candidate, options.ignoreCase ?? !isLinux )
	};

	const patternKey = `${ignoreCase ? pattern.toLowerCase() : pattern}_${!!options.trimForExclusions}_${ignoreCase}`;
	let parsedPattern = CACHE.get(patternKey);
	if (parsedPattern) {
		return wrapRelativePattern(parsedPattern, arg1, internalOptions);
	}

	let match: RegExpExecArray | null;
	if (T1.test(pattern)) {
		parsedPattern = trivia1(pattern.substring(4), pattern, internalOptions);
	} else if (match = T2.exec(trimForExclusions(pattern, internalOptions))) {
		parsedPattern = trivia2(match[1], pattern, internalOptions);
	} else if ((options.trimForExclusions ? T3_2 : T3).test(pattern)) {
		parsedPattern = trivia3(pattern, internalOptions);
	} else if (match = T4.exec(trimForExclusions(pattern, internalOptions))) {
		parsedPattern = trivia4and5(match[1].substring(1), pattern, true, internalOptions);
	} else if (match = T5.exec(trimForExclusions(pattern, internalOptions))) {
		parsedPattern = trivia4and5(match[1], pattern, false, internalOptions);
	}

	else {
		parsedPattern = toRegExp(pattern, internalOptions);
	}

	CACHE.set(patternKey, parsedPattern);

	return wrapRelativePattern(parsedPattern, arg1, internalOptions);
}

function wrapRelativePattern(parsedPattern: ParsedStringPattern, arg2: string | IRelativePattern, options: IGlobOptionsInternal): ParsedStringPattern {
	if (typeof arg2 === 'string') {
		return parsedPattern;
	}

	const wrappedPattern: ParsedStringPattern = function (path, basename) {
		if (!options.isEqualOrParent(path, arg2.base)) {
			return null;
		}


		return parsedPattern(ltrim(path.substring(arg2.base.length), sep), basename);
	};

	wrappedPattern.allBasenames = parsedPattern.allBasenames;
	wrappedPattern.allPaths = parsedPattern.allPaths;
	wrappedPattern.basenames = parsedPattern.basenames;
	wrappedPattern.patterns = parsedPattern.patterns;

	return wrappedPattern;
}

function trimForExclusions(pattern: string, options: IGlobOptions): string {
	return options.trimForExclusions && pattern.endsWith('/**') ? pattern.substring(0, pattern.length - 2) : pattern;
}

function trivia1(base: string, pattern: string, options: IGlobOptionsInternal): ParsedStringPattern {
	return function (path: string, basename?: string) {
		return typeof path === 'string' && options.endsWith(path, base) ? pattern : null;
	};
}

function trivia2(base: string, pattern: string, options: IGlobOptionsInternal): ParsedStringPattern {
	const slashBase = `/${base}`;
	const backslashBase = `\\${base}`;

	const parsedPattern: ParsedStringPattern = function (path: string, basename?: string) {
		if (typeof path !== 'string') {
			return null;
		}

		if (basename) {
			return options.equals(basename, base) ? pattern : null;
		}

		return options.equals(path, base) || options.endsWith(path, slashBase) || options.endsWith(path, backslashBase) ? pattern : null;
	};

	const basenames = [base];
	parsedPattern.basenames = basenames;
	parsedPattern.patterns = [pattern];
	parsedPattern.allBasenames = basenames;

	return parsedPattern;
}

function trivia3(pattern: string, options: IGlobOptionsInternal): ParsedStringPattern {
	const parsedPatterns = aggregateBasenameMatches(pattern.slice(1, -1)
		.split(',')
		.map(pattern => parsePattern(pattern, options))
		.filter(pattern => pattern !== NULL), pattern);

	const patternsLength = parsedPatterns.length;
	if (!patternsLength) {
		return NULL;
	}

	if (patternsLength === 1) {
		return parsedPatterns[0];
	}

	const parsedPattern: ParsedStringPattern = function (path: string, basename?: string) {
		for (let i = 0, n = parsedPatterns.length; i < n; i++) {
			if (parsedPatterns[i](path, basename)) {
				return pattern;
			}
		}

		return null;
	};

	const withBasenames = parsedPatterns.find(pattern => !!pattern.allBasenames);
	if (withBasenames) {
		parsedPattern.allBasenames = withBasenames.allBasenames;
	}

	const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, [] as string[]);
	if (allPaths.length) {
		parsedPattern.allPaths = allPaths;
	}

	return parsedPattern;
}

function trivia4and5(targetPath: string, pattern: string, matchPathEnds: boolean, options: IGlobOptionsInternal): ParsedStringPattern {
	const usingPosixSep = sep === posix.sep;
	const nativePath = usingPosixSep ? targetPath : targetPath.replace(ALL_FORWARD_SLASHES, sep);
	const nativePathEnd = sep + nativePath;
	const targetPathEnd = posix.sep + targetPath;

	let parsedPattern: ParsedStringPattern;
	if (matchPathEnds) {
		parsedPattern = function (path: string, basename?: string) {
			return typeof path === 'string' && (
				(options.equals(path, nativePath) || options.endsWith(path, nativePathEnd)) ||
				!usingPosixSep && (options.equals(path, targetPath) || options.endsWith(path, targetPathEnd))
			) ? pattern : null;
		};
	} else {
		parsedPattern = function (path: string, basename?: string) {
			return typeof path === 'string' && (options.equals(path, nativePath) || (!usingPosixSep && options.equals(path, targetPath))) ? pattern : null;
		};
	}

	parsedPattern.allPaths = [(matchPathEnds ? '*/' : './') + targetPath];

	return parsedPattern;
}

function toRegExp(pattern: string, options: IGlobOptions): ParsedStringPattern {
	try {
		const regExp = new RegExp(`^${parseRegExp(pattern)}$`, options.ignoreCase ? 'i' : undefined);
		return function (path: string) {
			regExp.lastIndex = 0;

			return typeof path === 'string' && regExp.test(path) ? pattern : null;
		};
	} catch {
		return NULL;
	}
}

export function match(pattern: string | IRelativePattern, path: string, options?: IGlobOptions): boolean;
export function match(expression: IExpression, path: string, options?: IGlobOptions): boolean;
export function match(arg1: string | IExpression | IRelativePattern, path: string, options?: IGlobOptions): boolean {
	if (!arg1 || typeof path !== 'string') {
		return false;
	}

	return parse(arg1, options)(path) as boolean;
}

export function parse(pattern: string | IRelativePattern, options?: IGlobOptions): ParsedPattern;
export function parse(expression: IExpression, options?: IGlobOptions): ParsedExpression;
export function parse(arg1: string | IExpression | IRelativePattern, options?: IGlobOptions): ParsedPattern | ParsedExpression;
export function parse(arg1: string | IExpression | IRelativePattern, options: IGlobOptions = {}): ParsedPattern | ParsedExpression {
	if (!arg1) {
		return FALSE;
	}

	if (typeof arg1 === 'string' || isRelativePattern(arg1)) {
		const parsedPattern = parsePattern(arg1, options);
		if (parsedPattern === NULL) {
			return FALSE;
		}

		const resultPattern: ParsedPattern & { allBasenames?: string[]; allPaths?: string[] } = function (path: string, basename?: string) {
			return !!parsedPattern(path, basename);
		};

		if (parsedPattern.allBasenames) {
			resultPattern.allBasenames = parsedPattern.allBasenames;
		}

		if (parsedPattern.allPaths) {
			resultPattern.allPaths = parsedPattern.allPaths;
		}

		return resultPattern;
	}

	return parsedExpression(arg1, options);
}

export function isRelativePattern(obj: unknown): obj is IRelativePattern {
	const rp = obj as IRelativePattern | undefined | null;
	if (!rp) {
		return false;
	}

	return typeof rp.base === 'string' && typeof rp.pattern === 'string';
}

export function getBasenameTerms(patternOrExpression: ParsedPattern | ParsedExpression): string[] {
	return (<ParsedStringPattern>patternOrExpression).allBasenames || [];
}

export function getPathTerms(patternOrExpression: ParsedPattern | ParsedExpression): string[] {
	return (<ParsedStringPattern>patternOrExpression).allPaths || [];
}

function parsedExpression(expression: IExpression, options: IGlobOptions): ParsedExpression {
	const parsedPatterns = aggregateBasenameMatches(Object.getOwnPropertyNames(expression)
		.map(pattern => parseExpressionPattern(pattern, expression[pattern], options))
		.filter(pattern => pattern !== NULL));

	const patternsLength = parsedPatterns.length;
	if (!patternsLength) {
		return NULL;
	}

	if (!parsedPatterns.some(parsedPattern => !!(<ParsedExpressionPattern>parsedPattern).requiresSiblings)) {
		if (patternsLength === 1) {
			return parsedPatterns[0] as ParsedStringPattern;
		}

		const resultExpression: ParsedStringPattern = function (path: string, basename?: string) {
			let resultPromises: Promise<string | null>[] | undefined = undefined;

			for (let i = 0, n = parsedPatterns.length; i < n; i++) {
				const result = parsedPatterns[i](path, basename);
				if (typeof result === 'string') {
					return result;
				}

				if (isThenable(result)) {
					if (!resultPromises) {
						resultPromises = [];
					}

					resultPromises.push(result);
				}
			}

			if (resultPromises) {
				return (async () => {
					for (const resultPromise of resultPromises) {
						const result = await resultPromise;
						if (typeof result === 'string') {
							return result;
						}
					}

					return null;
				})();
			}

			return null;
		};

		const withBasenames = parsedPatterns.find(pattern => !!pattern.allBasenames);
		if (withBasenames) {
			resultExpression.allBasenames = withBasenames.allBasenames;
		}

		const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, [] as string[]);
		if (allPaths.length) {
			resultExpression.allPaths = allPaths;
		}

		return resultExpression;
	}

	const resultExpression: ParsedStringPattern = function (path: string, base?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) {
		let name: string | undefined = undefined;
		let resultPromises: Promise<string | null>[] | undefined = undefined;

		for (let i = 0, n = parsedPatterns.length; i < n; i++) {

			const parsedPattern = (<ParsedExpressionPattern>parsedPatterns[i]);
			if (parsedPattern.requiresSiblings && hasSibling) {
				if (!base) {
					base = basename(path);
				}

				if (!name) {
					name = base.substring(0, base.length - extname(path).length);
				}
			}

			const result = parsedPattern(path, base, name, hasSibling);
			if (typeof result === 'string') {
				return result;
			}

			if (isThenable(result)) {
				if (!resultPromises) {
					resultPromises = [];
				}

				resultPromises.push(result);
			}
		}

		if (resultPromises) {
			return (async () => {
				for (const resultPromise of resultPromises) {
					const result = await resultPromise;
					if (typeof result === 'string') {
						return result;
					}
				}

				return null;
			})();
		}

		return null;
	};

	const withBasenames = parsedPatterns.find(pattern => !!pattern.allBasenames);
	if (withBasenames) {
		resultExpression.allBasenames = withBasenames.allBasenames;
	}

	const allPaths = parsedPatterns.reduce((all, current) => current.allPaths ? all.concat(current.allPaths) : all, [] as string[]);
	if (allPaths.length) {
		resultExpression.allPaths = allPaths;
	}

	return resultExpression;
}

function parseExpressionPattern(pattern: string, value: boolean | SiblingClause, options: IGlobOptions): (ParsedStringPattern | ParsedExpressionPattern) {
	if (value === false) {
		return NULL;
	}

	const parsedPattern = parsePattern(pattern, options);
	if (parsedPattern === NULL) {
		return NULL;
	}

	if (typeof value === 'boolean') {
		return parsedPattern;
	}

	if (value) {
		const when = value.when;
		if (typeof when === 'string') {
			const result: ParsedExpressionPattern = (path: string, basename?: string, name?: string, hasSibling?: (name: string) => boolean | Promise<boolean>) => {
				if (!hasSibling || !parsedPattern(path, basename)) {
					return null;
				}

				const clausePattern = when.replace('$(basename)', () => name!);
				const matched = hasSibling(clausePattern);
				return isThenable(matched) ?
					matched.then(match => match ? pattern : null) :
					matched ? pattern : null;
			};

			result.requiresSiblings = true;

			return result;
		}
	}

	return parsedPattern;
}

function aggregateBasenameMatches(parsedPatterns: Array<ParsedStringPattern | ParsedExpressionPattern>, result?: string): Array<ParsedStringPattern | ParsedExpressionPattern> {
	const basenamePatterns = parsedPatterns.filter(parsedPattern => !!(<ParsedStringPattern>parsedPattern).basenames);
	if (basenamePatterns.length < 2) {
		return parsedPatterns;
	}

	const basenames = basenamePatterns.reduce<string[]>((all, current) => {
		const basenames = (<ParsedStringPattern>current).basenames;

		return basenames ? all.concat(basenames) : all;
	}, [] as string[]);

	let patterns: string[];
	if (result) {
		patterns = [];

		for (let i = 0, n = basenames.length; i < n; i++) {
			patterns.push(result);
		}
	} else {
		patterns = basenamePatterns.reduce((all, current) => {
			const patterns = (<ParsedStringPattern>current).patterns;

			return patterns ? all.concat(patterns) : all;
		}, [] as string[]);
	}

	const aggregate: ParsedStringPattern = function (path: string, basename?: string) {
		if (typeof path !== 'string') {
			return null;
		}

		if (!basename) {
			let i: number;
			for (i = path.length; i > 0; i--) {
				const ch = path.charCodeAt(i - 1);
				if (ch === CharCode.Slash || ch === CharCode.Backslash) {
					break;
				}
			}

			basename = path.substring(i);
		}

		const index = basenames.indexOf(basename);
		return index !== -1 ? patterns[index] : null;
	};

	aggregate.basenames = basenames;
	aggregate.patterns = patterns;
	aggregate.allBasenames = basenames;

	const aggregatedPatterns = parsedPatterns.filter(parsedPattern => !(<ParsedStringPattern>parsedPattern).basenames);
	aggregatedPatterns.push(aggregate);

	return aggregatedPatterns;
}

export function patternsEquals(patternsA: Array<string | IRelativePattern> | undefined, patternsB: Array<string | IRelativePattern> | undefined): boolean {
	return equals(patternsA, patternsB, (a, b) => {
		if (typeof a === 'string' && typeof b === 'string') {
			return a === b;
		}

		if (typeof a !== 'string' && typeof b !== 'string') {
			return a.base === b.base && a.pattern === b.pattern;
		}

		return false;
	});
}
