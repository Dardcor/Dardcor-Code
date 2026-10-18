/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogger } from '../../../../../../platform/log/common/logService';
import { ServicesAccessor } from '../../../../../../util/dardcor/platform/instantiation/common/instantiation';
import { getBlockCloseToken } from '../../../prompt/src/parse';
import { APIChoice } from '../openai/openai';
import { TelemetryData, TelemetryStore, telemetry } from '../telemetry';
import { IPosition, TextDocumentContents } from '../textDocument';
import { isRepetitive } from './anomalyDetection';

function maybeSnipCompletion(accessor: ServicesAccessor, doc: TextDocumentContents, position: IPosition, completion: string): string {
	let blockCloseToken = '}';

	try {
		blockCloseToken = getBlockCloseToken(doc.detectedLanguageId) ?? '}';
	} catch (e) {
	}

	return maybeSnipCompletionImpl(
		{ getLineText: lineIdx => doc.lineAt(lineIdx).text, getLineCount: () => doc.lineCount },
		position,
		completion,
		blockCloseToken
	);
}

export interface ILines {
	getLineText(lineIdx: number): string;
	getLineCount(): number;
}

export function maybeSnipCompletionImpl(
	doc: ILines,
	position: IPosition,
	completion: string,
	blockCloseToken: string
): string {

	const completionLinesInfo = splitByNewLine(completion);
	const completionLines = completionLinesInfo.lines;
	if (completionLines.length === 1) {
		return completion;
	}

	for (let completionLineStartIdx = 1; completionLineStartIdx < completionLines.length; completionLineStartIdx++) {
		let matched = true;
		let docSkippedEmptyLineCount = 0;
		let completionSkippedEmptyLineCount = 0;
		for (
			let offset = 0;
			offset + completionLineStartIdx + completionSkippedEmptyLineCount < completionLines.length;
			offset++
		) {
			let docLine: string | undefined;
			while (true) {
				const docLineIdx = position.line + 1 + offset + docSkippedEmptyLineCount;
				docLine = docLineIdx >= doc.getLineCount() ? undefined : doc.getLineText(docLineIdx);
				if (docLine !== undefined && docLine.trim() === '') {
					docSkippedEmptyLineCount++;
				} else {
					break;
				}
			}

			let completionLineIdx: number | undefined;
			let completionLine: string | undefined;
			while (true) {
				completionLineIdx = completionLineStartIdx + offset + completionSkippedEmptyLineCount;
				completionLine =
					completionLineIdx >= completionLines.length ? undefined : completionLines[completionLineIdx];
				if (completionLine !== undefined && completionLine.trim() === '') {
					completionSkippedEmptyLineCount++;
				} else {
					break;
				}
			}

			const isLastCompletionLine = completionLineIdx === completionLines.length - 1;
			if (
				!completionLine ||
				!(
					docLine &&
					(isLastCompletionLine
						?
						docLine.startsWith(completionLine) || completionLine.startsWith(docLine)
						:
						docLine === completionLine && completionLine.trim() === blockCloseToken)
				)
			) {
				matched = false;
				break;
			}
		}
		if (matched) {
			const completionWithoutClosingBracketLines = completionLines
				.slice(0, completionLineStartIdx)
				.join(completionLinesInfo.newLineCharacter);
			return completionWithoutClosingBracketLines;
		}
	}

	return completion;
}

function splitByNewLine(text: string): { lines: string[]; newLineCharacter: string } {
	const newLineCharacter = text.includes('\r\n') ? '\r\n' : '\n';
	return {
		lines: text.split(newLineCharacter),
		newLineCharacter,
	};
}

function matchesNextLine(
	document: TextDocumentContents,
	position: IPosition,
	text: string,
	shouldTrim: boolean
): boolean {
	let nextLine = '';
	let lineNo: number = position.line + 1;
	const compareText = shouldTrim ? text.trim() : text;
	while (nextLine === '' && lineNo < document.lineCount) {
		nextLine = document.lineAt(lineNo).text;
		if (shouldTrim) {
			nextLine = nextLine.trim();
		}
		if (nextLine === compareText) {
			return true;
		}
		lineNo++;
	}
	return false;
}

export function postProcessChoiceInContext(
	accessor: ServicesAccessor,
	document: TextDocumentContents,
	position: IPosition,
	choice: APIChoice,
	isMoreMultiline: boolean,
	logger: ILogger
): APIChoice | undefined {
	if (isRepetitive(choice.tokens)) {
		const telemetryData = TelemetryData.createAndMarkAsIssued();
		telemetryData.extendWithRequestId(choice.requestId);
		telemetry(accessor, 'repetition.detected', telemetryData, TelemetryStore.Enhanced);
		logger.info('Filtered out repetitive solution');
		return undefined;
	}

	const postProcessedChoice = { ...choice };

	if (matchesNextLine(document, position, postProcessedChoice.completionText, !isMoreMultiline)) {
		const baseTelemetryData = TelemetryData.createAndMarkAsIssued();
		baseTelemetryData.extendWithRequestId(choice.requestId);
		telemetry(accessor, 'completion.alreadyInDocument', baseTelemetryData);
		telemetry(
			accessor,
			'completion.alreadyInDocument',
			baseTelemetryData.extendedBy({
				completionTextJson: JSON.stringify(postProcessedChoice.completionText),
			}),
			TelemetryStore.Enhanced
		);
		logger.info('Filtered out solution matching next line');
		return undefined;
	}

	postProcessedChoice.completionText = maybeSnipCompletion(
		accessor,
		document,
		position,
		postProcessedChoice.completionText
	);

	return postProcessedChoice.completionText ? postProcessedChoice : undefined;
}

export function checkSuffix(document: TextDocumentContents, position: IPosition, choice: APIChoice): number {
	const currentLine = document.lineAt(position.line);
	const restOfLine = currentLine.text.substring(position.character);
	if (restOfLine.length > 0) {
		if (choice.completionText.indexOf(restOfLine) !== -1) {
			return restOfLine.length;
		} else {
			let lastIndex = -1;
			let suffixLength = 0;
			for (const c of restOfLine) {
				const idx = choice.completionText.indexOf(c, lastIndex + 1);
				if (idx > lastIndex) {
					suffixLength++;
					lastIndex = idx;
				} else {
					break;
				}
			}
			return suffixLength;
		}
	}
	return 0;
}
