/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeRegExpCharacters } from '../../../../base/common/strings.js';



export const enum MonarchBracket {
	None = 0,
	Open = 1,
	Close = -1
}

export interface ILexerMin {
	languageId: string;
	includeLF: boolean;
	noThrow: boolean;
	ignoreCase: boolean;
	unicode: boolean;
	usesEmbedded: boolean;
	defaultToken: string;
	stateNames: { [stateName: string]: any };
	[attr: string]: any;
}

export interface ILexer extends ILexerMin {
	maxStack: number;
	start: string | null;
	ignoreCase: boolean;
	unicode: boolean;
	tokenPostfix: string;

	tokenizer: { [stateName: string]: IRule[] };
	brackets: IBracket[];
}

export interface IBracket {
	token: string;
	open: string;
	close: string;
}

export type FuzzyAction = IAction | string;

export function isFuzzyActionArr(what: FuzzyAction | FuzzyAction[]): what is FuzzyAction[] {
	return (Array.isArray(what));
}

export function isFuzzyAction(what: FuzzyAction | FuzzyAction[]): what is FuzzyAction {
	return !isFuzzyActionArr(what);
}

export function isString(what: FuzzyAction): what is string {
	return (typeof what === 'string');
}

export function isIAction(what: FuzzyAction): what is IAction {
	return !isString(what);
}

export interface IRule {
	action: FuzzyAction;
	matchOnlyAtLineStart: boolean;
	name: string;
	resolveRegex(state: string): RegExp;
}

export interface IAction {
	group?: FuzzyAction[];

	hasEmbeddedEndInCases?: boolean;
	test?: (id: string, matches: string[], state: string, eos: boolean) => FuzzyAction;

	token?: string;
	tokenSubst?: boolean;
	next?: string;
	nextEmbedded?: string;
	bracket?: MonarchBracket;
	log?: string;
	switchTo?: string;
	goBack?: number;
	transform?: (states: string[]) => string[];
}

export interface IBranch {
	name: string;
	value: FuzzyAction;
	test?: (id: string, matches: string[], state: string, eos: boolean) => boolean;
}


export function empty(s: string): boolean {
	return (s ? false : true);
}

export function fixCase(lexer: ILexerMin, str: string): string {
	return (lexer.ignoreCase && str ? str.toLowerCase() : str);
}

export function sanitize(s: string) {
	return s.replace(/[&<>'"_]/g, '-');
}


export function log(lexer: ILexerMin, msg: string) {
	console.log(`${lexer.languageId}: ${msg}`);
}


export function createError(lexer: ILexerMin, msg: string): Error {
	return new Error(`${lexer.languageId}: ${msg}`);
}


export function substituteMatches(lexer: ILexerMin, str: string, id: string, matches: string[], state: string): string {
	const re = /\$((\$)|(#)|(\d\d?)|[sS](\d\d?)|@(\w+))/g;
	let stateMatches: string[] | null = null;
	return str.replace(re, function (full, sub?, dollar?, hash?, n?, s?, attr?, ofs?, total?) {
		if (!empty(dollar)) {
			return '$';
		}
		if (!empty(hash)) {
			return fixCase(lexer, id);
		}
		if (!empty(n) && n < matches.length) {
			return fixCase(lexer, matches[n]);
		}
		if (!empty(attr) && lexer && typeof (lexer[attr]) === 'string') {
			return lexer[attr];
		}
		if (stateMatches === null) {
			stateMatches = state.split('.');
			stateMatches.unshift(state);
		}
		if (!empty(s) && s < stateMatches.length) {
			return fixCase(lexer, stateMatches[s]);
		}
		return '';
	});
}

export function substituteMatchesRe(lexer: ILexerMin, str: string, state: string): string {
	const re = /\$[sS](\d\d?)/g;
	let stateMatches: string[] | null = null;
	return str.replace(re, function (full, s) {
		if (stateMatches === null) {
			stateMatches = state.split('.');
			stateMatches.unshift(state);
		}
		if (!empty(s) && s < stateMatches.length) {
			return escapeRegExpCharacters(fixCase(lexer, stateMatches[s]));
		}
		return '';
	});
}

export function findRules(lexer: ILexer, inState: string): IRule[] | null {
	let state: string | null = inState;
	while (state && state.length > 0) {
		const rules = lexer.tokenizer[state];
		if (rules) {
			return rules;
		}

		const idx = state.lastIndexOf('.');
		if (idx < 0) {
			state = null;
		} else {
			state = state.substr(0, idx);
		}
	}
	return null;
}

export function stateExists(lexer: ILexerMin, inState: string): boolean {
	let state: string | null = inState;
	while (state && state.length > 0) {
		const exist = lexer.stateNames[state];
		if (exist) {
			return true;
		}

		const idx = state.lastIndexOf('.');
		if (idx < 0) {
			state = null;
		} else {
			state = state.substr(0, idx);
		}
	}
	return false;
}
