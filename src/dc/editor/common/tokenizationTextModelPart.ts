/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from './core/range.js';
import { StandardTokenType } from './encodedTokenAttributes.js';
import { LineTokens } from './tokens/lineTokens.js';
import { SparseMultilineTokens } from './tokens/sparseMultilineTokens.js';

export interface ITokenizationTextModelPart {
	readonly hasTokens: boolean;

	
	setSemanticTokens(tokens: SparseMultilineTokens[] | null, isComplete: boolean): void;

	
	setPartialSemanticTokens(range: Range, tokens: SparseMultilineTokens[] | null): void;

	
	hasCompleteSemanticTokens(): boolean;

	
	hasSomeSemanticTokens(): boolean;

	
	resetTokenization(): void;

	
	forceTokenization(lineNumber: number): void;

	
	tokenizeIfCheap(lineNumber: number): void;

	
	hasAccurateTokensForLine(lineNumber: number): boolean;

	
	isCheapToTokenize(lineNumber: number): boolean;

	
	getLineTokens(lineNumber: number): LineTokens;

	
	getTokenTypeIfInsertingCharacter(lineNumber: number, column: number, character: string): StandardTokenType;

	
	tokenizeLinesAt(lineNumber: number, lines: string[]): LineTokens[] | null;

	getLanguageId(): string;
	getLanguageIdAtPosition(lineNumber: number, column: number): string;

	setLanguageId(languageId: string, source?: string): void;

	readonly backgroundTokenizationState: BackgroundTokenizationState;
}

export const enum BackgroundTokenizationState {
	InProgress = 1,
	Completed = 2,
}
