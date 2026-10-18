/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { DocumentInfoWithOffset } from '../prompt';
import { getTokenizer, TokenizerName } from '../tokenization';

type CursorContextOptions = {
	maxTokenLength?: number;

	maxLineCount?: number;

	tokenizerName: TokenizerName;
};

const defaultCursorContextOptions: CursorContextOptions = {
	tokenizerName: TokenizerName.o200k,
};

function cursorContextOptions(options?: Partial<CursorContextOptions>): CursorContextOptions {
	return { ...defaultCursorContextOptions, ...options };
}

export interface CursorContextInfo {
	context: string;
	tokenLength: number;
	lineCount: number;
	tokenizerName: TokenizerName;
}

export function getCursorContext(
	doc: DocumentInfoWithOffset,
	options: Partial<CursorContextOptions> = {}
): CursorContextInfo {
	const completeOptions = cursorContextOptions(options);
	const tokenizer = getTokenizer(completeOptions.tokenizerName);

	if (completeOptions.maxLineCount !== undefined && completeOptions.maxLineCount < 0) {
		throw new Error('maxLineCount must be non-negative if defined');
	}
	if (completeOptions.maxTokenLength !== undefined && completeOptions.maxTokenLength < 0) {
		throw new Error('maxTokenLength must be non-negative if defined');
	}

	if (completeOptions.maxLineCount === 0 || completeOptions.maxTokenLength === 0) {
		return {
			context: '',
			lineCount: 0,
			tokenLength: 0,
			tokenizerName: completeOptions.tokenizerName,
		};
	}

	let context = doc.source.slice(0, doc.offset);
	if (completeOptions.maxLineCount !== undefined) {
		context = context.split('\n').slice(-completeOptions.maxLineCount).join('\n');
	}
	if (completeOptions.maxTokenLength !== undefined) {
		context = tokenizer.takeLastLinesTokens(context, completeOptions.maxTokenLength);
	}
	return {
		context,
		lineCount: context.split('\n').length,
		tokenLength: tokenizer.tokenLength(context),
		tokenizerName: completeOptions.tokenizerName,
	};
}
