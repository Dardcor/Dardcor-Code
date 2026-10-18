/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { Lazy } from '../../../../../base/common/lazy.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';

export interface IParsedLink {
	path: ILinkPartialRange;
	prefix?: ILinkPartialRange;
	suffix?: ILinkSuffix;
}

export interface ILinkSuffix {
	row: number | undefined;
	col: number | undefined;
	rowEnd: number | undefined;
	colEnd: number | undefined;
	suffix: ILinkPartialRange;
}

export interface ILinkPartialRange {
	index: number;
	text: string;
}

const linkSuffixRegexEol = new Lazy<RegExp>(() => generateLinkSuffixRegex(true));
const linkSuffixRegex = new Lazy<RegExp>(() => generateLinkSuffixRegex(false));

function generateLinkSuffixRegex(eolOnly: boolean) {
	let ri = 0;
	let ci = 0;
	let rei = 0;
	let cei = 0;
	function r(): string {
		return `(?<row${ri++}>\\d+)`;
	}
	function c(): string {
		return `(?<col${ci++}>\\d+)`;
	}
	function re(): string {
		return `(?<rowEnd${rei++}>\\d+)`;
	}
	function ce(): string {
		return `(?<colEnd${cei++}>\\d+)`;
	}

	const eolSuffix = eolOnly ? '$' : '';

	const lineAndColumnRegexClauses = [
		`(?::|#| |['"],|, )${r()}([:.]${c()}(?:-(?:${re()}\\.)?${ce()})?)?` + eolSuffix,
		`['"]?(?:,? |: ?| on )lines? ${r()}(?:-${re()})?(?:,? (?:col(?:umn)?|characters?) ${c()}(?:-${ce()})?)?` + eolSuffix,
		`:? ?[\\[\\(]${r()}(?:(?:, ?|:)${c()})?[\\]\\)]` + eolSuffix,
	];

	const suffixClause = lineAndColumnRegexClauses
		.join('|')
		.replace(/ /g, `[${'\u00A0'} ]`);

	return new RegExp(`(${suffixClause})`, eolOnly ? undefined : 'g');
}

export function removeLinkSuffix(link: string): string {
	const suffix = getLinkSuffix(link)?.suffix;
	if (!suffix) {
		return link;
	}
	return link.substring(0, suffix.index);
}

export function removeLinkQueryString(link: string): string {
	const start = link.startsWith('\\\\?\\') ? 4 : 0;
	const index = link.indexOf('?', start);
	if (index === -1) {
		return link;
	}
	return link.substring(0, index);
}

export function detectLinkSuffixes(line: string): ILinkSuffix[] {
	// Find all suffixes on the line. Since the regex global flag is used, lastIndex will be updated
	let match: RegExpExecArray | null;
	const results: ILinkSuffix[] = [];
	linkSuffixRegex.value.lastIndex = 0;
	while ((match = linkSuffixRegex.value.exec(line)) !== null) {
		const suffix = toLinkSuffix(match);
		if (suffix === null) {
			break;
		}
		results.push(suffix);
	}
	return results;
}

export function getLinkSuffix(link: string): ILinkSuffix | null {
	return toLinkSuffix(linkSuffixRegexEol.value.exec(link));
}

export function toLinkSuffix(match: RegExpExecArray | null): ILinkSuffix | null {
	const groups = match?.groups;
	if (!groups || match.length < 1) {
		return null;
	}
	return {
		row: parseIntOptional(groups.row0 || groups.row1 || groups.row2),
		col: parseIntOptional(groups.col0 || groups.col1 || groups.col2),
		rowEnd: parseIntOptional(groups.rowEnd0 || groups.rowEnd1 || groups.rowEnd2),
		colEnd: parseIntOptional(groups.colEnd0 || groups.colEnd1 || groups.colEnd2),
		suffix: { index: match.index, text: match[0] }
	};
}

function parseIntOptional(value: string | undefined): number | undefined {
	if (value === undefined) {
		return value;
	}
	return parseInt(value);
}

const linkWithSuffixPathCharacters = /(?<path>(?:file:\/\/\/)?[^\s\|<>\[\({][^\s\|<>]*)$/;

export function detectLinks(line: string, os: OperatingSystem) {
	const results = detectLinksViaSuffix(line);

	const noSuffixPaths = detectPathsNoSuffix(line, os);
	binaryInsertList(results, noSuffixPaths);

	return results;
}

function binaryInsertList(list: IParsedLink[], newItems: IParsedLink[]) {
	if (list.length === 0) {
		list.push(...newItems);
	}
	for (const item of newItems) {
		binaryInsert(list, item, 0, list.length);
	}
}

function binaryInsert(list: IParsedLink[], newItem: IParsedLink, low: number, high: number) {
	if (list.length === 0) {
		list.push(newItem);
		return;
	}
	if (low > high) {
		return;
	}
	const mid = Math.floor((low + high) / 2);
	if (
		mid >= list.length ||
		(newItem.path.index < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index))
	) {
		if (
			mid >= list.length ||
			(newItem.path.index + newItem.path.text.length < list[mid].path.index && (mid === 0 || newItem.path.index > list[mid - 1].path.index + list[mid - 1].path.text.length))
		) {
			list.splice(mid, 0, newItem);
		}
		return;
	}
	if (newItem.path.index > list[mid].path.index) {
		binaryInsert(list, newItem, mid + 1, high);
	} else {
		binaryInsert(list, newItem, low, mid - 1);
	}
}

function detectLinksViaSuffix(line: string): IParsedLink[] {
	const results: IParsedLink[] = [];

	const suffixes = detectLinkSuffixes(line);
	for (const suffix of suffixes) {
		const suffixEndIndex = suffix.suffix.index + suffix.suffix.text.length;
		if (line[suffixEndIndex] === '/') {
			continue;
		}
		const beforeSuffix = line.substring(0, suffix.suffix.index);
		const possiblePathMatch = beforeSuffix.match(linkWithSuffixPathCharacters);
		if (possiblePathMatch && possiblePathMatch.index !== undefined && possiblePathMatch.groups?.path) {
			let linkStartIndex = possiblePathMatch.index;
			let path = possiblePathMatch.groups.path;
			let prefix: ILinkPartialRange | undefined = undefined;
			const prefixMatch = path.match(/^(?<prefix>['"]+)/);
			if (prefixMatch?.groups?.prefix) {
				prefix = {
					index: linkStartIndex,
					text: prefixMatch.groups.prefix
				};
				path = path.substring(prefix.text.length);

				if (path.trim().length === 0) {
					continue;
				}

				if (prefixMatch.groups.prefix.length > 1) {
					if (suffix.suffix.text[0].match(/['"]/) && prefixMatch.groups.prefix[prefixMatch.groups.prefix.length - 1] === suffix.suffix.text[0]) {
						const trimPrefixAmount = prefixMatch.groups.prefix.length - 1;
						prefix.index += trimPrefixAmount;
						prefix.text = prefixMatch.groups.prefix[prefixMatch.groups.prefix.length - 1];
						linkStartIndex += trimPrefixAmount;
					}
				}
			}
			results.push({
				path: {
					index: linkStartIndex + (prefix?.text.length || 0),
					text: path
				},
				prefix,
				suffix
			});

			const openingBracketMatch = path.matchAll(/(?<bracket>[\[\(])(?![\]\)])/g);
			for (const match of openingBracketMatch) {
				const bracket = match.groups?.bracket;
				if (bracket) {
					results.push({
						path: {
							index: linkStartIndex + (prefix?.text.length || 0) + match.index + 1,
							text: path.substring(match.index + bracket.length)
						},
						prefix,
						suffix
					});
				}
			}
		}
	}

	return results;
}

enum RegexPathConstants {
	PathPrefix = '(?:\\.\\.?|\\~|file:\/\/)',
	PathSeparatorClause = '\\/',
	ExcludedPathCharactersClause = '[^\\0<>\\?\\s!`&*()\'":;\\\\]',
	ExcludedStartPathCharactersClause = '[^\\0<>\\?\\s!`&*()\\[\\]\'":;\\\\]',

	WinOtherPathPrefix = '\\.\\.?|\\~',
	WinPathSeparatorClause = '(?:\\\\|\\/)',
	WinExcludedPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\'":;]',
	WinExcludedStartPathCharactersClause = '[^\\0<>\\?\\|\\/\\s!`&*()\\[\\]\'":;]',
}

const unixLocalLinkClause = '(?:(?:' + RegexPathConstants.PathPrefix + '|(?:' + RegexPathConstants.ExcludedStartPathCharactersClause + RegexPathConstants.ExcludedPathCharactersClause + '*))?(?:' + RegexPathConstants.PathSeparatorClause + '(?:' + RegexPathConstants.ExcludedPathCharactersClause + ')+)+)';

export const winDrivePrefix = '(?:\\\\\\\\\\?\\\\|file:\\/\\/\\/)?[a-zA-Z]:';

const winLocalLinkClause = '(?:(?:' + `(?:${winDrivePrefix}|${RegexPathConstants.WinOtherPathPrefix})` + '|(?:' + RegexPathConstants.WinExcludedStartPathCharactersClause + RegexPathConstants.WinExcludedPathCharactersClause + '*))?(?:' + RegexPathConstants.WinPathSeparatorClause + '(?:' + RegexPathConstants.WinExcludedPathCharactersClause + ')+)+)';

const diffFilePrefix = '[abciow12]\\/';

const gitDiffLineRegex = new Lazy<RegExp>(() => new RegExp(`^[-+]{3} ${diffFilePrefix}`));
const gitDiffTextRegex = new Lazy<RegExp>(() => new RegExp(`^${diffFilePrefix}`));

function detectPathsNoSuffix(line: string, os: OperatingSystem): IParsedLink[] {
	const results: IParsedLink[] = [];

	const regex = new RegExp(os === OperatingSystem.Windows ? winLocalLinkClause : unixLocalLinkClause, 'g');
	let match;
	while ((match = regex.exec(line)) !== null) {
		let text = match[0];
		let index = match.index;
		if (!text) {
			break;
		}

		if (
			(gitDiffLineRegex.value.test(line) && index === 4) ||
			(line.startsWith('diff --git') && gitDiffTextRegex.value.test(text))
		) {
			text = text.substring(2);
			index += 2;
		}

		results.push({
			path: {
				index,
				text
			},
			prefix: undefined,
			suffix: undefined
		});
	}

	return results;
}
