/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range, TextDocument } from 'vscode';

export interface InlineSuggestionEdit {
	readonly range: Range;
	readonly newText: string;
}

export function toInlineSuggestion(cursorPos: Position, doc: TextDocument, range: Range, newText: string, advanced: boolean = true): InlineSuggestionEdit | undefined {
	if (range.start.line === range.end.line && range.start.line === cursorPos.line) {
		const sameLineEdit = validateSameLineGhostText(cursorPos, doc, range, newText);
		if (sameLineEdit) {
			return sameLineEdit;
		}
	}

	if (advanced) {
		const cursorEdit = tryRebaseAsCursorEdit(cursorPos, doc, range, newText);
		if (cursorEdit) {
			return cursorEdit;
		}
	}

	const nextLineInsertion = tryAdjustNextLineInsertion(cursorPos, doc, range, newText);
	if (nextLineInsertion) {
		return nextLineInsertion;
	}

	return undefined;
}

function tryRebaseAsCursorEdit(cursorPos: Position, doc: TextDocument, range: Range, newText: string): InlineSuggestionEdit | undefined {
	const cursorOffset = doc.offsetAt(cursorPos);
	const lineEnd = doc.lineAt(cursorPos.line).range.end;
	const lineEndOffset = doc.offsetAt(lineEnd);
	const rangeStartOffset = doc.offsetAt(range.start);
	const rangeEndOffset = doc.offsetAt(range.end);
	const affectedStart = doc.positionAt(Math.min(cursorOffset, rangeStartOffset));
	const affectedEnd = doc.positionAt(Math.max(lineEndOffset, rangeEndOffset));

	const editedText = doc.getText(new Range(affectedStart, range.start)) + newText + doc.getText(new Range(range.end, affectedEnd));
	const unchangedPrefix = doc.getText(new Range(affectedStart, cursorPos));
	const unchangedSuffix = doc.getText(new Range(lineEnd, affectedEnd));
	const cursorEditTextEnd = editedText.length - unchangedSuffix.length;
	if (
		cursorEditTextEnd < unchangedPrefix.length
		|| !editedText.startsWith(unchangedPrefix)
		|| !editedText.endsWith(unchangedSuffix)
	) {
		return undefined;
	}

	const cursorEdit = {
		range: new Range(cursorPos, lineEnd),
		newText: editedText.substring(unchangedPrefix.length, cursorEditTextEnd),
	};
	return validateSameLineGhostText(cursorPos, doc, cursorEdit.range, cursorEdit.newText);
}

function tryAdjustNextLineInsertion(cursorPos: Position, doc: TextDocument, range: Range, newText: string): InlineSuggestionEdit | undefined {
	if (!range.isEmpty) {
		return undefined;
	}
	if (cursorPos.line + 1 !== range.start.line || range.start.character !== 0) {
		return undefined;
	}
	if (doc.lineAt(cursorPos.line).text.length !== cursorPos.character) {
		return undefined;
	}

	const lineBreak = doc.getText(new Range(cursorPos, range.start));
	if (!newText.endsWith(lineBreak)) {
		return undefined;
	}
	const trimmedNewText = newText.substring(0, newText.length - lineBreak.length);
	return { range: new Range(cursorPos, cursorPos), newText: lineBreak + trimmedNewText };
}

function validateSameLineGhostText(cursorPos: Position, doc: TextDocument, range: Range, newText: string): InlineSuggestionEdit | undefined {
	const replacedText = doc.getText(range);
	const cursorOffsetInReplacedText = cursorPos.character - range.start.character;
	if (cursorOffsetInReplacedText < 0) {
		return undefined;
	}
	if (replacedText.substring(0, cursorOffsetInReplacedText) !== newText.substring(0, cursorOffsetInReplacedText)) {
		return undefined;
	}
	if (!isSubword(replacedText, newText)) {
		return undefined;
	}
	return { range, newText };
}

export function isSubword(a: string, b: string): boolean {
	for (let aIdx = 0, bIdx = 0; aIdx < a.length; bIdx++) {
		if (bIdx >= b.length) {
			return false;
		}
		if (a[aIdx] === b[bIdx]) {
			aIdx++;
		}
	}
	return true;
}
