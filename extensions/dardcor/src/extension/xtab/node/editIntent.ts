/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as xtabPromptOptions from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { ILogger } from '../../../platform/log/common/logService';

export interface ParseEditIntentResult {
	editIntent: xtabPromptOptions.EditIntent;
	remainingLinesStream: AsyncIterable<string>;
	parseError?: string;
}

export enum EditIntentParseMode {
	Tags = 'tags',
	ShortName = 'shortName'
}

export async function parseEditIntentFromStream(
	linesStream: AsyncIterable<string>,
	tracer: ILogger,
	mode: EditIntentParseMode = EditIntentParseMode.Tags
): Promise<ParseEditIntentResult> {
	if (mode === EditIntentParseMode.ShortName) {
		return parseEditIntentFromStreamShortName(linesStream, tracer);
	}

	return parseEditIntentFromStreamTags(linesStream, tracer);
}

async function parseEditIntentFromStreamShortName(
	linesStream: AsyncIterable<string>,
	tracer: ILogger
): Promise<ParseEditIntentResult> {
	let editIntent: xtabPromptOptions.EditIntent = xtabPromptOptions.EditIntent.High;
	let parseError: string | undefined;

	const linesIter = linesStream[Symbol.asyncIterator]();
	const firstLineResult = await linesIter.next();

	if (firstLineResult.done) {
		parseError = 'emptyResponse';
		tracer.warn(`Empty response stream, no edit_intent short name found`);
		const remainingLinesStream: AsyncIterable<string> = (async function* () { })();
		return { editIntent, remainingLinesStream, parseError };
	}

	const firstLine = firstLineResult.value.trim();

	const parsedIntent = xtabPromptOptions.EditIntent.fromShortName(firstLine);

	if (parsedIntent !== undefined) {
		editIntent = parsedIntent;
		tracer.trace(`Parsed edit_intent short name from first line: "${firstLine}" -> ${editIntent}`);

		const remainingLinesStream: AsyncIterable<string> = (async function* () {
			let next = await linesIter.next();
			while (!next.done) {
				yield next.value;
				next = await linesIter.next();
			}
		})();

		return { editIntent, remainingLinesStream, parseError };
	}

	parseError = `unknownIntentValue:${firstLine}`;

	tracer.warn(`Edit intent parse error: ${parseError} (using Xtab275EditIntentShort prompting strategy). ` +
		`Defaulting to High (always show). First line was: "${firstLine.substring(0, 100)}..."`);

	const remainingLinesStream: AsyncIterable<string> = (async function* () {
		yield firstLineResult.value;
		let next = await linesIter.next();
		while (!next.done) {
			yield next.value;
			next = await linesIter.next();
		}
	})();

	return { editIntent, remainingLinesStream, parseError };
}

async function parseEditIntentFromStreamTags(
	linesStream: AsyncIterable<string>,
	tracer: ILogger
): Promise<ParseEditIntentResult> {
	const EDIT_INTENT_START_TAG = '<|edit_intent|>';
	const EDIT_INTENT_END_TAG = '<|/edit_intent|>';

	let editIntent: xtabPromptOptions.EditIntent = xtabPromptOptions.EditIntent.High;
	let parseError: string | undefined;

	const linesIter = linesStream[Symbol.asyncIterator]();
	const firstLineResult = await linesIter.next();

	if (firstLineResult.done) {
		parseError = 'emptyResponse';
		tracer.warn(`Empty response stream, no edit_intent tag found`);
		const remainingLinesStream: AsyncIterable<string> = (async function* () { })();
		return { editIntent, remainingLinesStream, parseError };
	}

	const firstLine = firstLineResult.value;

	const startIdx = firstLine.indexOf(EDIT_INTENT_START_TAG);
	const endIdx = firstLine.indexOf(EDIT_INTENT_END_TAG);

	if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
		const intentValue = firstLine.substring(
			startIdx + EDIT_INTENT_START_TAG.length,
			endIdx
		).trim().toLowerCase();

		const knownIntentValues = ['no_edit', 'low', 'medium', 'high'];
		if (!knownIntentValues.includes(intentValue)) {
			parseError = `unknownIntentValue:${intentValue}`;
			tracer.warn(`Unknown edit_intent value: "${intentValue}", defaulting to High`);
		}

		editIntent = xtabPromptOptions.EditIntent.fromString(intentValue);
		tracer.trace(`Parsed edit_intent from first line: "${intentValue}" -> ${editIntent}`);

		const afterEndTag = firstLine.substring(endIdx + EDIT_INTENT_END_TAG.length);

		const remainingLinesStream: AsyncIterable<string> = (async function* () {
			if (afterEndTag.trim() !== '') {
				yield afterEndTag;
			}
			let next = await linesIter.next();
			while (!next.done) {
				yield next.value;
				next = await linesIter.next();
			}
		})();

		return { editIntent, remainingLinesStream, parseError };
	}

	if (startIdx !== -1 && endIdx === -1) {
		parseError = 'malformedTag:startWithoutEnd';
	} else if (startIdx === -1 && endIdx !== -1) {
		parseError = 'malformedTag:endWithoutStart';
	} else {
		parseError = 'noTagFound';
	}

	tracer.warn(`Edit intent parse error: ${parseError} (using Xtab275EditIntent prompting strategy). ` +
		`Defaulting to High (always show). First line was: "${firstLine.substring(0, 100)}..."`);

	const remainingLinesStream: AsyncIterable<string> = (async function* () {
		yield firstLine;
		let next = await linesIter.next();
		while (!next.done) {
			yield next.value;
			next = await linesIter.next();
		}
	})();

	return { editIntent, remainingLinesStream, parseError };
}

