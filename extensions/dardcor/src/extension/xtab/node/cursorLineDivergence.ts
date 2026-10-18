/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringEdit } from '../../../util/dardcor/editor/common/core/edits/stringEdit';
import { Position } from '../../../util/dardcor/editor/common/core/position';
import { PositionOffsetTransformer } from '../../../util/dardcor/editor/common/core/text/positionToOffset';

export function getCurrentLine(
	originalDoc: PositionOffsetTransformer,
	docLineIdx: number,
	intermediateEdit: StringEdit,
	precomputed?: { currentDoc: string; currentTransformer: PositionOffsetTransformer },
): string | undefined {
	const lineNumber = docLineIdx + 1;
	const lineCount = originalDoc.textLength.lineCount + 1;

	if (lineNumber < 1 || lineNumber > lineCount) {
		return undefined;
	}

	const lineStartOffset = originalDoc.getOffset(new Position(lineNumber, 1));

	let delta = 0;
	for (const replacement of intermediateEdit.replacements) {
		if (replacement.replaceRange.endExclusive <= lineStartOffset) {
			delta += replacement.newText.length - replacement.replaceRange.length;
		} else if (replacement.replaceRange.start < lineStartOffset) {
			return undefined;
		} else {
			break;
		}
	}

	const mappedOffset = lineStartOffset + delta;
	const currentDoc = precomputed?.currentDoc ?? intermediateEdit.apply(originalDoc.text);
	const currentTransformer = precomputed?.currentTransformer ?? new PositionOffsetTransformer(currentDoc);

	const currentPos = currentTransformer.getPosition(mappedOffset);
	const lineStart = currentTransformer.getOffset(new Position(currentPos.lineNumber, 1));
	const lineLen = currentTransformer.getLineLength(currentPos.lineNumber);
	return currentDoc.substring(lineStart, lineStart + lineLen);
}

interface LineDiff {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly replaced: string;
	readonly inserted: string;
}

function diffLine(before: string, after: string): LineDiff {
	let prefixLen = 0;
	while (prefixLen < before.length && prefixLen < after.length
		&& before[prefixLen] === after[prefixLen]) {
		prefixLen++;
	}
	let suffixLen = 0;
	while (suffixLen < before.length - prefixLen && suffixLen < after.length - prefixLen
		&& before[before.length - 1 - suffixLen] === after[after.length - 1 - suffixLen]) {
		suffixLen++;
	}
	return {
		startOffset: prefixLen,
		endOffset: before.length - suffixLen,
		replaced: before.substring(prefixLen, before.length - suffixLen),
		inserted: after.substring(prefixLen, after.length - suffixLen),
	};
}

export function isModelLineCompatible(originalLine: string, currentLine: string, modelLine: string): boolean {
	const userEdit = diffLine(originalLine, currentLine);
	const modelEdit = diffLine(originalLine, modelLine);

	if (userEdit.replaced.length === 0 && userEdit.inserted.length === 0) {
		return true;
	}

	const userEditWithinModelEdit = userEdit.startOffset >= modelEdit.startOffset
		&& userEdit.endOffset <= modelEdit.endOffset;

	if (!userEditWithinModelEdit) {
		return false;
	}

	return isUserEditCompatibleWithModelEdit(userEdit, modelEdit, currentLine, modelLine);
}

const AUTO_CLOSE_PAIRS = new Set(['()', '[]', '{}', '<>', '""', `''`, '``']);

function isUserEditCompatibleWithModelEdit(userEdit: LineDiff, modelEdit: LineDiff, currentLine: string, modelLine: string): boolean {
	if (userEdit.replaced.length > 0) {
		if (currentLine === modelLine) {
			return true;
		}

		return userEdit.startOffset === modelEdit.startOffset
			&& userEdit.endOffset === modelEdit.endOffset
			&& userEdit.replaced === modelEdit.replaced
			&& userEdit.inserted.length > 0
			&& isUserTypingCompatibleWithModelText(userEdit.inserted, modelEdit.inserted);
	}

	return isUserTypingCompatibleWithModelText(userEdit.inserted, modelEdit.inserted);
}

function isUserTypingCompatibleWithModelText(userTypedText: string, modelNewText: string): boolean {
	if (modelNewText.startsWith(userTypedText)) {
		return true;
	}

	if (AUTO_CLOSE_PAIRS.has(userTypedText)) {
		return isSubsequenceOf(userTypedText, modelNewText);
	}

	return false;
}

function isSubsequenceOf(subsequence: string, str: string): boolean {
	let si = 0;
	for (let ti = 0; ti < subsequence.length; ti++) {
		const idx = str.indexOf(subsequence[ti], si);
		if (idx === -1) {
			return false;
		}
		si = idx + 1;
	}
	return true;
}
