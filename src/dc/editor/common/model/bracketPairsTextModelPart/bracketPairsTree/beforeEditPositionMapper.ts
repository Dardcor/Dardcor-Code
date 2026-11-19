/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../../../core/range.js';
import { Length, lengthAdd, lengthDiffNonNegative, lengthLessThanEqual, lengthOfString, lengthToObj, positionToLength, toLength } from './length.js';
import { TextLength } from '../../../core/text/textLength.js';
import { IModelContentChange } from '../../mirrorTextModel.js';

export class TextEditInfo {
	public static fromModelContentChanges(changes: IModelContentChange[]): TextEditInfo[] {
		const edits = changes.map(c => {
			const range = Range.lift(c.range);
			return new TextEditInfo(
				positionToLength(range.getStartPosition()),
				positionToLength(range.getEndPosition()),
				lengthOfString(c.text)
			);
		}).reverse();
		return edits;
	}

	constructor(
		public readonly startOffset: Length,
		public readonly endOffset: Length,
		public readonly newLength: Length
	) {
	}

	toString(): string {
		return `[${lengthToObj(this.startOffset)}...${lengthToObj(this.endOffset)}) -> ${lengthToObj(this.newLength)}`;
	}
}

export class BeforeEditPositionMapper {
	private nextEditIdx = 0;
	private deltaOldToNewLineCount = 0;
	private deltaOldToNewColumnCount = 0;
	private deltaLineIdxInOld = -1;
	private readonly edits: readonly TextEditInfoCache[];

	constructor(
		edits: readonly TextEditInfo[],
	) {
		this.edits = edits.map(edit => TextEditInfoCache.from(edit));
	}

	getOffsetBeforeChange(offset: Length): Length {
		this.adjustNextEdit(offset);
		return this.translateCurToOld(offset);
	}

	getDistanceToNextChange(offset: Length): Length | null {
		this.adjustNextEdit(offset);

		const nextEdit = this.edits[this.nextEditIdx];
		const nextChangeOffset = nextEdit ? this.translateOldToCur(nextEdit.offsetObj) : null;
		if (nextChangeOffset === null) {
			return null;
		}

		return lengthDiffNonNegative(offset, nextChangeOffset);
	}

	private translateOldToCur(oldOffsetObj: TextLength): Length {
		if (oldOffsetObj.lineCount === this.deltaLineIdxInOld) {
			return toLength(oldOffsetObj.lineCount + this.deltaOldToNewLineCount, oldOffsetObj.columnCount + this.deltaOldToNewColumnCount);
		} else {
			return toLength(oldOffsetObj.lineCount + this.deltaOldToNewLineCount, oldOffsetObj.columnCount);
		}
	}

	private translateCurToOld(newOffset: Length): Length {
		const offsetObj = lengthToObj(newOffset);
		if (offsetObj.lineCount - this.deltaOldToNewLineCount === this.deltaLineIdxInOld) {
			return toLength(offsetObj.lineCount - this.deltaOldToNewLineCount, offsetObj.columnCount - this.deltaOldToNewColumnCount);
		} else {
			return toLength(offsetObj.lineCount - this.deltaOldToNewLineCount, offsetObj.columnCount);
		}
	}

	private adjustNextEdit(offset: Length) {
		while (this.nextEditIdx < this.edits.length) {
			const nextEdit = this.edits[this.nextEditIdx];

			const nextEditEndOffsetInCur = this.translateOldToCur(nextEdit.endOffsetAfterObj);

			if (lengthLessThanEqual(nextEditEndOffsetInCur, offset)) {
				this.nextEditIdx++;

				const nextEditEndOffsetInCurObj = lengthToObj(nextEditEndOffsetInCur);

				const nextEditEndOffsetBeforeInCurObj = lengthToObj(this.translateOldToCur(nextEdit.endOffsetBeforeObj));

				const lineDelta = nextEditEndOffsetInCurObj.lineCount - nextEditEndOffsetBeforeInCurObj.lineCount;
				this.deltaOldToNewLineCount += lineDelta;

				const previousColumnDelta = this.deltaLineIdxInOld === nextEdit.endOffsetBeforeObj.lineCount ? this.deltaOldToNewColumnCount : 0;
				const columnDelta = nextEditEndOffsetInCurObj.columnCount - nextEditEndOffsetBeforeInCurObj.columnCount;
				this.deltaOldToNewColumnCount = previousColumnDelta + columnDelta;
				this.deltaLineIdxInOld = nextEdit.endOffsetBeforeObj.lineCount;
			} else {
				break;
			}
		}
	}
}

class TextEditInfoCache {
	static from(edit: TextEditInfo): TextEditInfoCache {
		return new TextEditInfoCache(edit.startOffset, edit.endOffset, edit.newLength);
	}

	public readonly endOffsetBeforeObj: TextLength;
	public readonly endOffsetAfterObj: TextLength;
	public readonly offsetObj: TextLength;

	constructor(
		startOffset: Length,
		endOffset: Length,
		textLength: Length,
	) {
		this.endOffsetBeforeObj = lengthToObj(endOffset);
		this.endOffsetAfterObj = lengthToObj(lengthAdd(startOffset, textLength));
		this.offsetObj = lengthToObj(startOffset);
	}
}
