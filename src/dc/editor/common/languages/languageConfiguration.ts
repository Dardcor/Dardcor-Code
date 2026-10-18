/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../../../base/common/charCode.js';
import { StandardTokenType } from '../encodedTokenAttributes.js';
import { ScopedLineTokens } from './supports.js';

export interface LineCommentConfig {
	comment: string;
	noIndent?: boolean;
}

export interface CommentRule {
	lineComment?: string | LineCommentConfig | null;
	blockComment?: CharacterPair | null;
}

export interface LanguageConfiguration {
	comments?: CommentRule;
	brackets?: CharacterPair[];
	wordPattern?: RegExp;
	indentationRules?: IndentationRule;
	onEnterRules?: OnEnterRule[];
	autoClosingPairs?: IAutoClosingPairConditional[];
	surroundingPairs?: IAutoClosingPair[];
	colorizedBracketPairs?: CharacterPair[];
	autoCloseBefore?: string;

	folding?: FoldingRules;

	__electricCharacterSupport?: {
		docComment?: IDocComment;
	};
}

/**
 * @internal
 */
type OrUndefined<T> = { [P in keyof T]: T[P] | undefined };

/**
 * @internal
 */
export type ExplicitLanguageConfiguration = OrUndefined<Required<LanguageConfiguration>>;

export interface IndentationRule {
	decreaseIndentPattern: RegExp;
	increaseIndentPattern: RegExp;
	indentNextLinePattern?: RegExp | null;
	unIndentedLinePattern?: RegExp | null;

}

export interface FoldingMarkers {
	start: RegExp;
	end: RegExp;
}

export interface FoldingRules {
	offSide?: boolean;

	markers?: FoldingMarkers;
}

export interface OnEnterRule {
	beforeText: RegExp;
	afterText?: RegExp;
	previousLineText?: RegExp;
	action: EnterAction;
}

export interface IDocComment {
	open: string;
	close?: string;
}

export type CharacterPair = [string, string];

export interface IAutoClosingPair {
	open: string;
	close: string;
}

export interface IAutoClosingPairConditional extends IAutoClosingPair {
	notIn?: string[];
}

export enum IndentAction {
	None = 0,
	Indent = 1,
	IndentOutdent = 2,
	Outdent = 3
}

export interface EnterAction {
	indentAction: IndentAction;
	appendText?: string;
	removeText?: number;
}

/**
 * @internal
 */
export interface CompleteEnterAction {
	indentAction: IndentAction;
	appendText: string;
	removeText: number;
	indentation: string;
}

/**
 * @internal
 */
export class StandardAutoClosingPairConditional {

	readonly open: string;
	readonly close: string;
	private readonly _inString: boolean;
	private readonly _inComment: boolean;
	private readonly _inRegEx: boolean;
	private _neutralCharacter: string | null = null;
	private _neutralCharacterSearched: boolean = false;

	constructor(source: IAutoClosingPairConditional) {
		this.open = source.open;
		this.close = source.close;

		this._inString = true;
		this._inComment = true;
		this._inRegEx = true;

		if (Array.isArray(source.notIn)) {
			for (let i = 0, len = source.notIn.length; i < len; i++) {
				const notIn: string = source.notIn[i];
				switch (notIn) {
					case 'string':
						this._inString = false;
						break;
					case 'comment':
						this._inComment = false;
						break;
					case 'regex':
						this._inRegEx = false;
						break;
				}
			}
		}
	}

	public isOK(standardToken: StandardTokenType): boolean {
		switch (standardToken) {
			case StandardTokenType.Other:
				return true;
			case StandardTokenType.Comment:
				return this._inComment;
			case StandardTokenType.String:
				return this._inString;
			case StandardTokenType.RegEx:
				return this._inRegEx;
		}
	}

	public shouldAutoClose(context: ScopedLineTokens, column: number): boolean {
		if (context.getTokenCount() === 0) {
			return true;
		}

		const tokenIndex = context.findTokenIndexAtOffset(column - 2);
		const standardTokenType = context.getStandardTokenType(tokenIndex);
		return this.isOK(standardTokenType);
	}

	private _findNeutralCharacterInRange(fromCharCode: number, toCharCode: number): string | null {
		for (let charCode = fromCharCode; charCode <= toCharCode; charCode++) {
			const character = String.fromCharCode(charCode);
			if (!this.open.includes(character) && !this.close.includes(character)) {
				return character;
			}
		}
		return null;
	}

	public findNeutralCharacter(): string | null {
		if (!this._neutralCharacterSearched) {
			this._neutralCharacterSearched = true;
			if (!this._neutralCharacter) {
				this._neutralCharacter = this._findNeutralCharacterInRange(CharCode.Digit0, CharCode.Digit9);
			}
			if (!this._neutralCharacter) {
				this._neutralCharacter = this._findNeutralCharacterInRange(CharCode.a, CharCode.z);
			}
			if (!this._neutralCharacter) {
				this._neutralCharacter = this._findNeutralCharacterInRange(CharCode.A, CharCode.Z);
			}
		}
		return this._neutralCharacter;
	}
}

/**
 * @internal
 */
export class AutoClosingPairs {

	public readonly autoClosingPairsOpenByStart: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly autoClosingPairsOpenByEnd: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly autoClosingPairsCloseByStart: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly autoClosingPairsCloseByEnd: Map<string, StandardAutoClosingPairConditional[]>;
	public readonly autoClosingPairsCloseSingleChar: Map<string, StandardAutoClosingPairConditional[]>;

	constructor(autoClosingPairs: StandardAutoClosingPairConditional[]) {
		this.autoClosingPairsOpenByStart = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsOpenByEnd = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseByStart = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseByEnd = new Map<string, StandardAutoClosingPairConditional[]>();
		this.autoClosingPairsCloseSingleChar = new Map<string, StandardAutoClosingPairConditional[]>();
		for (const pair of autoClosingPairs) {
			appendEntry(this.autoClosingPairsOpenByStart, pair.open.charAt(0), pair);
			appendEntry(this.autoClosingPairsOpenByEnd, pair.open.charAt(pair.open.length - 1), pair);
			appendEntry(this.autoClosingPairsCloseByStart, pair.close.charAt(0), pair);
			appendEntry(this.autoClosingPairsCloseByEnd, pair.close.charAt(pair.close.length - 1), pair);
			if (pair.close.length === 1 && pair.open.length === 1) {
				appendEntry(this.autoClosingPairsCloseSingleChar, pair.close, pair);
			}
		}
	}
}

function appendEntry<K, V>(target: Map<K, V[]>, key: K, value: V): void {
	if (target.has(key)) {
		target.get(key)!.push(value);
	} else {
		target.set(key, [value]);
	}
}
