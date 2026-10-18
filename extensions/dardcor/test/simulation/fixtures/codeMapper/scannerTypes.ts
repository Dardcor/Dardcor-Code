/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';


export const enum ScanError {
	None = 0,
	UnexpectedEndOfComment = 1,
	UnexpectedEndOfString = 2,
	UnexpectedEndOfNumber = 3,
	InvalidUnicode = 4,
	InvalidEscapeCharacter = 5,
	InvalidCharacter = 6
}

export const enum SyntaxKind {
	OpenBraceToken = 1,
	CloseBraceToken = 2,
	OpenBracketToken = 3,
	CloseBracketToken = 4,
	CommaToken = 5,
	ColonToken = 6,
	NullKeyword = 7,
	TrueKeyword = 8,
	FalseKeyword = 9,
	StringLiteral = 10,
	NumericLiteral = 11,
	LineCommentTrivia = 12,
	BlockCommentTrivia = 13,
	LineBreakTrivia = 14,
	Trivia = 15,
	Unknown = 16,
	EOF = 17
}




export interface JSONScanner {



	setPosition(pos: number): void;



	scan(): SyntaxKind;



	getPosition(): number;



	getToken(): SyntaxKind;



	getTokenValue(): string;



	getTokenOffset(): number;



	getTokenLength(): number;



	getTokenStartLine(): number;



	getTokenStartCharacter(): number;



	getTokenError(): ScanError;
}
