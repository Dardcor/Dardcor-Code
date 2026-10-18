/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CurrentDocument } from './xtabCurrentDocument';

export function isInlineSuggestionFromTextAfterCursor(textAfterCursor: string): boolean | undefined {
	const isMiddleOfLine = isMiddleOfTheLineFromTextAfterCursor(textAfterCursor);
	const isValidMiddleOfLine = isValidMiddleOfTheLineFromTextAfterCursor(textAfterCursor);

	if (isMiddleOfLine && !isValidMiddleOfLine) {
		return undefined;
	}

	return isMiddleOfLine && isValidMiddleOfLine;
}

export function determineIsInlineSuggestionPosition(document: CurrentDocument): boolean | undefined {
	const textAfterCursor = document.textAfterCursor();
	return isInlineSuggestionFromTextAfterCursor(textAfterCursor);
}

function isMiddleOfTheLineFromTextAfterCursor(textAfterCursor: string): boolean {
	return textAfterCursor.trim().length !== 0;
}

function isValidMiddleOfTheLineFromTextAfterCursor(textAfterCursor: string): boolean {
	const endOfLine = textAfterCursor.trim();
	return /^\s*[)>}\]"'`]*\s*[:{;,]?\s*$/.test(endOfLine);
}
