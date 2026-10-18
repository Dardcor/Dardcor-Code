/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BugIndicatingError } from '../../../util/dardcor/base/common/errors';
import { Position } from '../../../util/dardcor/editor/common/core/position';
import { StringText } from '../../../util/dardcor/editor/common/core/text/abstractText';
import { PositionOffsetTransformer } from '../../../util/dardcor/editor/common/core/text/positionToOffsetImpl';

export class CurrentDocument {

	public readonly lines: string[];

	public readonly cursorOffset: number;

	public readonly transformer: PositionOffsetTransformer;

	public readonly cursorLineOffset: number;

	constructor(
		public readonly content: StringText,
		public readonly cursorPosition: Position,
	) {
		this.lines = content.getLines();
		this.transformer = content.getTransformer();
		this.cursorOffset = this.transformer.getOffset(cursorPosition);
		this.cursorLineOffset = this.cursorPosition.lineNumber - 1;
	}

	lineWithCursor(): string {
		const line = this.lines.at(this.cursorLineOffset);
		if (line === undefined) {
			throw new BugIndicatingError(`CurrentDocument#lineWithCursor: cursor is out of bounds: cursor: ${this.cursorLineOffset}, doc line count: ${this.lines.length}`);
		}
		return line;
	}

	textAfterCursor(): string {
		const line = this.lineWithCursor();
		return line.substring(this.cursorPosition.column - 1);
	}

	isCursorAtEndOfLine(): boolean {
		const afterCursor = this.textAfterCursor();
		const isAtEndOfLine = afterCursor.match(/^\s*$/) !== null;
		return isAtEndOfLine;
	}
}
