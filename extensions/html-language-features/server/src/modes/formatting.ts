/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModes, Settings, LanguageModeRange, TextDocument, Range, TextEdit, FormattingOptions, Position } from './languageModes.js';
import { pushAll } from '../utils/arrays.js';
import { isEOL } from '../utils/strings.js';

export async function format(languageModes: LanguageModes, document: TextDocument, formatRange: Range, formattingOptions: FormattingOptions, settings: Settings | undefined, enabledModes: { [mode: string]: boolean }) {
	const result: TextEdit[] = [];

	const endPos = formatRange.end;
	let endOffset = document.offsetAt(endPos);
	const content = document.getText();
	if (endPos.character === 0 && endPos.line > 0 && endOffset !== content.length) {
		const prevLineStart = document.offsetAt(Position.create(endPos.line - 1, 0));
		while (isEOL(content, endOffset - 1) && endOffset > prevLineStart) {
			endOffset--;
		}
		formatRange = Range.create(formatRange.start, document.positionAt(endOffset));
	}



	const allRanges = languageModes.getModesInRange(document, formatRange);
	let i = 0;
	let startPos = formatRange.start;
	const isHTML = (range: LanguageModeRange) => range.mode && range.mode.getId() === 'html';

	while (i < allRanges.length && !isHTML(allRanges[i])) {
		const range = allRanges[i];
		if (!range.attributeValue && range.mode && range.mode.format) {
			const edits = await range.mode.format(document, Range.create(startPos, range.end), formattingOptions, settings);
			pushAll(result, edits);
		}
		startPos = range.end;
		i++;
	}
	if (i === allRanges.length) {
		return result;
	}
	formatRange = Range.create(startPos, formatRange.end);

	const htmlMode = languageModes.getMode('html')!;
	const htmlEdits = await htmlMode.format!(document, formatRange, formattingOptions, settings);
	let htmlFormattedContent = TextDocument.applyEdits(document, htmlEdits);
	if (formattingOptions.insertFinalNewline && endOffset === content.length && !htmlFormattedContent.endsWith('\n')) {
		htmlFormattedContent = htmlFormattedContent + '\n';
		htmlEdits.push(TextEdit.insert(endPos, '\n'));
	}
	const newDocument = TextDocument.create(document.uri + '.tmp', document.languageId, document.version, htmlFormattedContent);
	try {
		const afterFormatRangeLength = document.getText().length - document.offsetAt(formatRange.end);
		const newFormatRange = Range.create(formatRange.start, newDocument.positionAt(htmlFormattedContent.length - afterFormatRangeLength));
		const embeddedRanges = languageModes.getModesInRange(newDocument, newFormatRange);

		const embeddedEdits: TextEdit[] = [];

		for (const r of embeddedRanges) {
			const mode = r.mode;
			if (mode && mode.format && enabledModes[mode.getId()] && !r.attributeValue) {
				const edits = await mode.format(newDocument, r, formattingOptions, settings);
				for (const edit of edits) {
					embeddedEdits.push(edit);
				}
			}
		}

		if (embeddedEdits.length === 0) {
			pushAll(result, htmlEdits);
			return result;
		}

		const resultContent = TextDocument.applyEdits(newDocument, embeddedEdits);
		const resultReplaceText = resultContent.substring(document.offsetAt(formatRange.start), resultContent.length - afterFormatRangeLength);

		result.push(TextEdit.replace(formatRange, resultReplaceText));
		return result;
	} finally {
		languageModes.onDocumentRemoved(newDocument);
	}

}
