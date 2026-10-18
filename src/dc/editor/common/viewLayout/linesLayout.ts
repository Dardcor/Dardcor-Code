/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorWhitespace, IPartialViewLinesViewportData, ILineHeightChangeAccessor, IViewWhitespaceViewportData, IWhitespaceChangeAccessor } from '../viewModel.js';
import * as strings from '../../../base/common/strings.js';
import { CustomLineHeightData, LineHeightsManager } from './lineHeights.js';

interface IPendingChange { id: string; newAfterLineNumber: number; newHeight: number }
interface IPendingRemove { id: string }

class PendingChanges {
	private _hasPending: boolean;
	private _inserts: EditorWhitespace[];
	private _changes: IPendingChange[];
	private _removes: IPendingRemove[];

	constructor() {
		this._hasPending = false;
		this._inserts = [];
		this._changes = [];
		this._removes = [];
	}

	public insert(x: EditorWhitespace): void {
		this._hasPending = true;
		this._inserts.push(x);
	}

	public change(x: IPendingChange): void {
		this._hasPending = true;
		this._changes.push(x);
	}

	public remove(x: IPendingRemove): void {
		this._hasPending = true;
		this._removes.push(x);
	}

	public commit(linesLayout: LinesLayout): void {
		if (!this._hasPending) {
			return;
		}

		const inserts = this._inserts;
		const changes = this._changes;
		const removes = this._removes;

		this._hasPending = false;
		this._inserts = [];
		this._changes = [];
		this._removes = [];

		linesLayout._commitPendingChanges(inserts, changes, removes);
	}
}

export class EditorWhitespace implements IEditorWhitespace {
	public id: string;
	public afterLineNumber: number;
	public ordinal: number;
	public height: number;
	public minWidth: number;
	public prefixSum: number;

	constructor(id: string, afterLineNumber: number, ordinal: number, height: number, minWidth: number) {
		this.id = id;
		this.afterLineNumber = afterLineNumber;
		this.ordinal = ordinal;
		this.height = height;
		this.minWidth = minWidth;
		this.prefixSum = 0;
	}
}

export class LinesLayout {

	private static INSTANCE_COUNT = 0;

	private readonly _instanceId: string;
	private readonly _pendingChanges: PendingChanges;
	private _lastWhitespaceId: number;
	private _arr: EditorWhitespace[];
	private _prefixSumValidIndex: number;
	private _minWidth: number;
	private _lineCount: number;
	private _paddingTop: number;
	private _paddingBottom: number;
	private _lineHeightsManager: LineHeightsManager;

	constructor(lineCount: number, defaultLineHeight: number, paddingTop: number, paddingBottom: number, customLineHeightData: CustomLineHeightData[]) {
		this._instanceId = strings.singleLetterHash(++LinesLayout.INSTANCE_COUNT);
		this._pendingChanges = new PendingChanges();
		this._lastWhitespaceId = 0;
		this._arr = [];
		this._prefixSumValidIndex = -1;
		this._minWidth = -1;
		this._lineCount = lineCount;
		this._paddingTop = paddingTop;
		this._paddingBottom = paddingBottom;
		this._lineHeightsManager = new LineHeightsManager(defaultLineHeight, customLineHeightData);
	}

	public static findInsertionIndex(arr: EditorWhitespace[], afterLineNumber: number, ordinal: number): number {
		let low = 0;
		let high = arr.length;

		while (low < high) {
			const mid = ((low + high) >>> 1);

			if (afterLineNumber === arr[mid].afterLineNumber) {
				if (ordinal < arr[mid].ordinal) {
					high = mid;
				} else {
					low = mid + 1;
				}
			} else if (afterLineNumber < arr[mid].afterLineNumber) {
				high = mid;
			} else {
				low = mid + 1;
			}
		}

		return low;
	}

	public setDefaultLineHeight(lineHeight: number): void {
		this._lineHeightsManager.defaultLineHeight = lineHeight;
	}

	public setPadding(paddingTop: number, paddingBottom: number): void {
		this._paddingTop = paddingTop;
		this._paddingBottom = paddingBottom;
	}

	public onFlushed(lineCount: number, customLineHeightData: CustomLineHeightData[]): void {
		this._lineCount = lineCount;
		this._lineHeightsManager = new LineHeightsManager(this._lineHeightsManager.defaultLineHeight, customLineHeightData);
	}

	public changeLineHeights(callback: (accessor: ILineHeightChangeAccessor) => void): boolean {
		let hadAChange = false;
		const accessor: ILineHeightChangeAccessor = {
			insertOrChangeCustomLineHeight: (decorationId: string, startLineNumber: number, endLineNumber: number, lineHeight: number): void => {
				hadAChange = true;
				this._lineHeightsManager.insertOrChangeCustomLineHeight(decorationId, startLineNumber, endLineNumber, lineHeight);
			},
			removeCustomLineHeight: (decorationId: string): void => {
				hadAChange = true;
				this._lineHeightsManager.removeCustomLineHeight(decorationId);
			}
		};
		callback(accessor);
		return hadAChange;
	}

	public changeWhitespace(callback: (accessor: IWhitespaceChangeAccessor) => void): boolean {
		let hadAChange = false;
		try {
			const accessor: IWhitespaceChangeAccessor = {
				insertWhitespace: (afterLineNumber: number, ordinal: number, heightInPx: number, minWidth: number): string => {
					hadAChange = true;
					afterLineNumber = afterLineNumber | 0;
					ordinal = ordinal | 0;
					heightInPx = heightInPx | 0;
					minWidth = minWidth | 0;
					const id = this._instanceId + (++this._lastWhitespaceId);
					this._pendingChanges.insert(new EditorWhitespace(id, afterLineNumber, ordinal, heightInPx, minWidth));
					return id;
				},
				changeOneWhitespace: (id: string, newAfterLineNumber: number, newHeight: number): void => {
					hadAChange = true;
					newAfterLineNumber = newAfterLineNumber | 0;
					newHeight = newHeight | 0;
					this._pendingChanges.change({ id, newAfterLineNumber, newHeight });
				},
				removeWhitespace: (id: string): void => {
					hadAChange = true;
					this._pendingChanges.remove({ id });
				}
			};
			callback(accessor);
		} finally {
			this._pendingChanges.commit(this);
		}
		return hadAChange;
	}

	public _commitPendingChanges(inserts: EditorWhitespace[], changes: IPendingChange[], removes: IPendingRemove[]): void {
		if (inserts.length > 0 || removes.length > 0) {
			this._minWidth = -1;
		}

		if (inserts.length + changes.length + removes.length <= 1) {
			for (const insert of inserts) {
				this._insertWhitespace(insert);
			}
			for (const change of changes) {
				this._changeOneWhitespace(change.id, change.newAfterLineNumber, change.newHeight);
			}
			for (const remove of removes) {
				const index = this._findWhitespaceIndex(remove.id);
				if (index === -1) {
					continue;
				}
				this._removeWhitespace(index);
			}
			return;
		}


		const toRemove = new Set<string>();
		for (const remove of removes) {
			toRemove.add(remove.id);
		}

		const toChange = new Map<string, IPendingChange>();
		for (const change of changes) {
			toChange.set(change.id, change);
		}

		const applyRemoveAndChange = (whitespaces: EditorWhitespace[]): EditorWhitespace[] => {
			const result: EditorWhitespace[] = [];
			for (const whitespace of whitespaces) {
				if (toRemove.has(whitespace.id)) {
					continue;
				}
				if (toChange.has(whitespace.id)) {
					const change = toChange.get(whitespace.id)!;
					whitespace.afterLineNumber = change.newAfterLineNumber;
					whitespace.height = change.newHeight;
				}
				result.push(whitespace);
			}
			return result;
		};

		const result = applyRemoveAndChange(this._arr).concat(applyRemoveAndChange(inserts));
		result.sort((a, b) => {
			if (a.afterLineNumber === b.afterLineNumber) {
				return a.ordinal - b.ordinal;
			}
			return a.afterLineNumber - b.afterLineNumber;
		});

		this._arr = result;
		this._prefixSumValidIndex = -1;
	}

	private _insertWhitespace(whitespace: EditorWhitespace): void {
		const insertIndex = LinesLayout.findInsertionIndex(this._arr, whitespace.afterLineNumber, whitespace.ordinal);
		this._arr.splice(insertIndex, 0, whitespace);
		this._prefixSumValidIndex = Math.min(this._prefixSumValidIndex, insertIndex - 1);
	}

	private _findWhitespaceIndex(id: string): number {
		const arr = this._arr;
		for (let i = 0, len = arr.length; i < len; i++) {
			if (arr[i].id === id) {
				return i;
			}
		}
		return -1;
	}

	private _changeOneWhitespace(id: string, newAfterLineNumber: number, newHeight: number): void {
		const index = this._findWhitespaceIndex(id);
		if (index === -1) {
			return;
		}
		if (this._arr[index].height !== newHeight) {
			this._arr[index].height = newHeight;
			this._prefixSumValidIndex = Math.min(this._prefixSumValidIndex, index - 1);
		}
		if (this._arr[index].afterLineNumber !== newAfterLineNumber) {

			const whitespace = this._arr[index];

			this._removeWhitespace(index);

			whitespace.afterLineNumber = newAfterLineNumber;

			this._insertWhitespace(whitespace);
		}
	}

	private _removeWhitespace(removeIndex: number): void {
		this._arr.splice(removeIndex, 1);
		this._prefixSumValidIndex = Math.min(this._prefixSumValidIndex, removeIndex - 1);
	}

	public onLinesDeleted(fromLineNumber: number, toLineNumber: number): void {
		fromLineNumber = fromLineNumber | 0;
		toLineNumber = toLineNumber | 0;

		this._lineCount -= (toLineNumber - fromLineNumber + 1);
		for (let i = 0, len = this._arr.length; i < len; i++) {
			const afterLineNumber = this._arr[i].afterLineNumber;

			if (fromLineNumber <= afterLineNumber && afterLineNumber <= toLineNumber) {
				this._arr[i].afterLineNumber = fromLineNumber - 1;
			} else if (afterLineNumber > toLineNumber) {
				this._arr[i].afterLineNumber -= (toLineNumber - fromLineNumber + 1);
			}
		}
		this._lineHeightsManager.onLinesDeleted(fromLineNumber, toLineNumber);
	}

	public onLinesInserted(fromLineNumber: number, toLineNumber: number): void {
		fromLineNumber = fromLineNumber | 0;
		toLineNumber = toLineNumber | 0;

		this._lineCount += (toLineNumber - fromLineNumber + 1);
		for (let i = 0, len = this._arr.length; i < len; i++) {
			const afterLineNumber = this._arr[i].afterLineNumber;

			if (fromLineNumber <= afterLineNumber) {
				this._arr[i].afterLineNumber += (toLineNumber - fromLineNumber + 1);
			}
		}
		this._lineHeightsManager.onLinesInserted(fromLineNumber, toLineNumber);
	}

	public getWhitespacesTotalHeight(): number {
		if (this._arr.length === 0) {
			return 0;
		}
		return this.getWhitespacesAccumulatedHeight(this._arr.length - 1);
	}

	public getWhitespacesAccumulatedHeight(index: number): number {
		index = index | 0;

		let startIndex = Math.max(0, this._prefixSumValidIndex + 1);
		if (startIndex === 0) {
			this._arr[0].prefixSum = this._arr[0].height;
			startIndex++;
		}

		for (let i = startIndex; i <= index; i++) {
			this._arr[i].prefixSum = this._arr[i - 1].prefixSum + this._arr[i].height;
		}
		this._prefixSumValidIndex = Math.max(this._prefixSumValidIndex, index);
		return this._arr[index].prefixSum;
	}

	public getLinesTotalHeight(): number {
		const linesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(this._lineCount);
		const whitespacesHeight = this.getWhitespacesTotalHeight();

		return linesHeight + whitespacesHeight + this._paddingTop + this._paddingBottom;
	}

	public getWhitespaceAccumulatedHeightBeforeLineNumber(lineNumber: number): number {
		lineNumber = lineNumber | 0;

		const lastWhitespaceBeforeLineNumber = this._findLastWhitespaceBeforeLineNumber(lineNumber);

		if (lastWhitespaceBeforeLineNumber === -1) {
			return 0;
		}

		return this.getWhitespacesAccumulatedHeight(lastWhitespaceBeforeLineNumber);
	}

	private _findLastWhitespaceBeforeLineNumber(lineNumber: number): number {
		lineNumber = lineNumber | 0;

		const arr = this._arr;
		let low = 0;
		let high = arr.length - 1;

		while (low <= high) {
			const delta = (high - low) | 0;
			const halfDelta = (delta / 2) | 0;
			const mid = (low + halfDelta) | 0;

			if (arr[mid].afterLineNumber < lineNumber) {
				if (mid + 1 >= arr.length || arr[mid + 1].afterLineNumber >= lineNumber) {
					return mid;
				} else {
					low = (mid + 1) | 0;
				}
			} else {
				high = (mid - 1) | 0;
			}
		}

		return -1;
	}

	private _findFirstWhitespaceAfterLineNumber(lineNumber: number): number {
		lineNumber = lineNumber | 0;

		const lastWhitespaceBeforeLineNumber = this._findLastWhitespaceBeforeLineNumber(lineNumber);
		const firstWhitespaceAfterLineNumber = lastWhitespaceBeforeLineNumber + 1;

		if (firstWhitespaceAfterLineNumber < this._arr.length) {
			return firstWhitespaceAfterLineNumber;
		}

		return -1;
	}

	public getFirstWhitespaceIndexAfterLineNumber(lineNumber: number): number {
		lineNumber = lineNumber | 0;

		return this._findFirstWhitespaceAfterLineNumber(lineNumber);
	}

	public getVerticalOffsetForLineNumber(lineNumber: number, includeViewZones = false): number {
		lineNumber = lineNumber | 0;

		let previousLinesHeight: number;
		if (lineNumber > 1) {
			previousLinesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(lineNumber - 1);
		} else {
			previousLinesHeight = 0;
		}

		const previousWhitespacesHeight = this.getWhitespaceAccumulatedHeightBeforeLineNumber(lineNumber - (includeViewZones ? 1 : 0));

		return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;
	}

	public getLineHeightForLineNumber(lineNumber: number): number {
		return this._lineHeightsManager.heightForLineNumber(lineNumber);
	}

	public getVerticalOffsetAfterLineNumber(lineNumber: number, includeViewZones = false): number {
		lineNumber = lineNumber | 0;
		const previousLinesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(lineNumber);
		const previousWhitespacesHeight = this.getWhitespaceAccumulatedHeightBeforeLineNumber(lineNumber + (includeViewZones ? 1 : 0));
		return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;
	}

	public hasWhitespace(): boolean {
		return this.getWhitespacesCount() > 0;
	}

	public getWhitespaceMinWidth(): number {
		if (this._minWidth === -1) {
			let minWidth = 0;
			for (let i = 0, len = this._arr.length; i < len; i++) {
				minWidth = Math.max(minWidth, this._arr[i].minWidth);
			}
			this._minWidth = minWidth;
		}
		return this._minWidth;
	}

	public isAfterLines(verticalOffset: number): boolean {
		const totalHeight = this.getLinesTotalHeight();
		return verticalOffset > totalHeight;
	}

	public isInTopPadding(verticalOffset: number): boolean {
		if (this._paddingTop === 0) {
			return false;
		}
		return (verticalOffset < this._paddingTop);
	}

	public isInBottomPadding(verticalOffset: number): boolean {
		if (this._paddingBottom === 0) {
			return false;
		}
		const totalHeight = this.getLinesTotalHeight();
		return (verticalOffset >= totalHeight - this._paddingBottom);
	}

	public getLineNumberAtOrAfterVerticalOffset(verticalOffset: number): number {
		verticalOffset = verticalOffset | 0;

		if (verticalOffset < 0) {
			return 1;
		}

		const linesCount = this._lineCount | 0;
		let minLineNumber = 1;
		let maxLineNumber = linesCount;

		while (minLineNumber < maxLineNumber) {
			const midLineNumber = ((minLineNumber + maxLineNumber) / 2) | 0;

			const lineHeight = this.getLineHeightForLineNumber(midLineNumber);
			const midLineNumberVerticalOffset = this.getVerticalOffsetForLineNumber(midLineNumber) | 0;

			if (verticalOffset >= midLineNumberVerticalOffset + lineHeight) {
				minLineNumber = midLineNumber + 1;
			} else if (verticalOffset >= midLineNumberVerticalOffset) {
				return midLineNumber;
			} else {
				maxLineNumber = midLineNumber;
			}
		}

		if (minLineNumber > linesCount) {
			return linesCount;
		}

		return minLineNumber;
	}

	public getLinesViewportData(verticalOffset1: number, verticalOffset2: number): IPartialViewLinesViewportData {
		verticalOffset1 = verticalOffset1 | 0;
		verticalOffset2 = verticalOffset2 | 0;

		const startLineNumber = this.getLineNumberAtOrAfterVerticalOffset(verticalOffset1) | 0;
		const startLineNumberVerticalOffset = this.getVerticalOffsetForLineNumber(startLineNumber) | 0;

		let endLineNumber = this._lineCount | 0;

		let whitespaceIndex = this.getFirstWhitespaceIndexAfterLineNumber(startLineNumber) | 0;
		const whitespaceCount = this.getWhitespacesCount() | 0;
		let currentWhitespaceHeight: number;
		let currentWhitespaceAfterLineNumber: number;

		if (whitespaceIndex === -1) {
			whitespaceIndex = whitespaceCount;
			currentWhitespaceAfterLineNumber = endLineNumber + 1;
			currentWhitespaceHeight = 0;
		} else {
			currentWhitespaceAfterLineNumber = this.getAfterLineNumberForWhitespaceIndex(whitespaceIndex) | 0;
			currentWhitespaceHeight = this.getHeightForWhitespaceIndex(whitespaceIndex) | 0;
		}

		let currentVerticalOffset = startLineNumberVerticalOffset;
		let currentLineRelativeOffset = currentVerticalOffset;

		const STEP_SIZE = 500000;
		let bigNumbersDelta = 0;
		if (startLineNumberVerticalOffset >= STEP_SIZE) {
			bigNumbersDelta = Math.floor(startLineNumberVerticalOffset / STEP_SIZE) * STEP_SIZE;
			bigNumbersDelta = Math.floor(bigNumbersDelta / this._lineHeightsManager.defaultLineHeight) * this._lineHeightsManager.defaultLineHeight;

			currentLineRelativeOffset -= bigNumbersDelta;
		}

		const linesOffsets: number[] = [];

		const verticalCenter = verticalOffset1 + (verticalOffset2 - verticalOffset1) / 2;
		let centeredLineNumber = -1;

		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const lineHeight = this.getLineHeightForLineNumber(lineNumber);
			if (centeredLineNumber === -1) {
				const currentLineTop = currentVerticalOffset;
				const currentLineBottom = currentVerticalOffset + lineHeight;
				if ((currentLineTop <= verticalCenter && verticalCenter < currentLineBottom) || currentLineTop > verticalCenter) {
					centeredLineNumber = lineNumber;
				}
			}

			currentVerticalOffset += lineHeight;
			linesOffsets[lineNumber - startLineNumber] = currentLineRelativeOffset;

			currentLineRelativeOffset += lineHeight;
			while (currentWhitespaceAfterLineNumber === lineNumber) {
				currentLineRelativeOffset += currentWhitespaceHeight;

				currentVerticalOffset += currentWhitespaceHeight;
				whitespaceIndex++;

				if (whitespaceIndex >= whitespaceCount) {
					currentWhitespaceAfterLineNumber = endLineNumber + 1;
				} else {
					currentWhitespaceAfterLineNumber = this.getAfterLineNumberForWhitespaceIndex(whitespaceIndex) | 0;
					currentWhitespaceHeight = this.getHeightForWhitespaceIndex(whitespaceIndex) | 0;
				}
			}

			if (currentVerticalOffset >= verticalOffset2) {
				endLineNumber = lineNumber;
				break;
			}
		}

		if (centeredLineNumber === -1) {
			centeredLineNumber = endLineNumber;
		}

		const endLineNumberVerticalOffset = this.getVerticalOffsetForLineNumber(endLineNumber) | 0;

		let completelyVisibleStartLineNumber = startLineNumber;
		let completelyVisibleEndLineNumber = endLineNumber;

		if (completelyVisibleStartLineNumber < completelyVisibleEndLineNumber) {
			if (startLineNumberVerticalOffset < verticalOffset1) {
				completelyVisibleStartLineNumber++;
			}
		}
		if (completelyVisibleStartLineNumber < completelyVisibleEndLineNumber) {
			const endLineHeight = this.getLineHeightForLineNumber(endLineNumber);
			if (endLineNumberVerticalOffset + endLineHeight > verticalOffset2) {
				completelyVisibleEndLineNumber--;
			}
		}

		return {
			bigNumbersDelta: bigNumbersDelta,
			startLineNumber: startLineNumber,
			endLineNumber: endLineNumber,
			relativeVerticalOffset: linesOffsets,
			centeredLineNumber: centeredLineNumber,
			completelyVisibleStartLineNumber: completelyVisibleStartLineNumber,
			completelyVisibleEndLineNumber: completelyVisibleEndLineNumber,
			lineHeight: this._lineHeightsManager.defaultLineHeight,
		};
	}

	public getVerticalOffsetForWhitespaceIndex(whitespaceIndex: number): number {
		whitespaceIndex = whitespaceIndex | 0;

		const afterLineNumber = this.getAfterLineNumberForWhitespaceIndex(whitespaceIndex);

		let previousLinesHeight: number;
		if (afterLineNumber >= 1) {
			previousLinesHeight = this._lineHeightsManager.getAccumulatedLineHeightsIncludingLineNumber(afterLineNumber);
		} else {
			previousLinesHeight = 0;
		}

		let previousWhitespacesHeight: number;
		if (whitespaceIndex > 0) {
			previousWhitespacesHeight = this.getWhitespacesAccumulatedHeight(whitespaceIndex - 1);
		} else {
			previousWhitespacesHeight = 0;
		}
		return previousLinesHeight + previousWhitespacesHeight + this._paddingTop;
	}

	public getWhitespaceIndexAtOrAfterVerticallOffset(verticalOffset: number): number {
		verticalOffset = verticalOffset | 0;

		let minWhitespaceIndex = 0;
		let maxWhitespaceIndex = this.getWhitespacesCount() - 1;

		if (maxWhitespaceIndex < 0) {
			return -1;
		}

		const maxWhitespaceVerticalOffset = this.getVerticalOffsetForWhitespaceIndex(maxWhitespaceIndex);
		const maxWhitespaceHeight = this.getHeightForWhitespaceIndex(maxWhitespaceIndex);
		if (verticalOffset >= maxWhitespaceVerticalOffset + maxWhitespaceHeight) {
			return -1;
		}

		while (minWhitespaceIndex < maxWhitespaceIndex) {
			const midWhitespaceIndex = Math.floor((minWhitespaceIndex + maxWhitespaceIndex) / 2);

			const midWhitespaceVerticalOffset = this.getVerticalOffsetForWhitespaceIndex(midWhitespaceIndex);
			const midWhitespaceHeight = this.getHeightForWhitespaceIndex(midWhitespaceIndex);

			if (verticalOffset >= midWhitespaceVerticalOffset + midWhitespaceHeight) {
				minWhitespaceIndex = midWhitespaceIndex + 1;
			} else if (verticalOffset >= midWhitespaceVerticalOffset) {
				return midWhitespaceIndex;
			} else {
				maxWhitespaceIndex = midWhitespaceIndex;
			}
		}
		return minWhitespaceIndex;
	}

	public getWhitespaceAtVerticalOffset(verticalOffset: number): IViewWhitespaceViewportData | null {
		verticalOffset = verticalOffset | 0;

		const candidateIndex = this.getWhitespaceIndexAtOrAfterVerticallOffset(verticalOffset);

		if (candidateIndex < 0) {
			return null;
		}

		if (candidateIndex >= this.getWhitespacesCount()) {
			return null;
		}

		const candidateTop = this.getVerticalOffsetForWhitespaceIndex(candidateIndex);

		if (candidateTop > verticalOffset) {
			return null;
		}

		const candidateHeight = this.getHeightForWhitespaceIndex(candidateIndex);
		const candidateId = this.getIdForWhitespaceIndex(candidateIndex);
		const candidateAfterLineNumber = this.getAfterLineNumberForWhitespaceIndex(candidateIndex);

		return {
			id: candidateId,
			afterLineNumber: candidateAfterLineNumber,
			verticalOffset: candidateTop,
			height: candidateHeight
		};
	}

	public getWhitespaceViewportData(verticalOffset1: number, verticalOffset2: number): IViewWhitespaceViewportData[] {
		verticalOffset1 = verticalOffset1 | 0;
		verticalOffset2 = verticalOffset2 | 0;

		const startIndex = this.getWhitespaceIndexAtOrAfterVerticallOffset(verticalOffset1);
		const endIndex = this.getWhitespacesCount() - 1;

		if (startIndex < 0) {
			return [];
		}

		const result: IViewWhitespaceViewportData[] = [];
		for (let i = startIndex; i <= endIndex; i++) {
			const top = this.getVerticalOffsetForWhitespaceIndex(i);
			const height = this.getHeightForWhitespaceIndex(i);
			if (top >= verticalOffset2) {
				break;
			}

			result.push({
				id: this.getIdForWhitespaceIndex(i),
				afterLineNumber: this.getAfterLineNumberForWhitespaceIndex(i),
				verticalOffset: top,
				height: height
			});
		}

		return result;
	}

	public getWhitespaces(): IEditorWhitespace[] {
		return this._arr.slice(0);
	}

	public getWhitespacesCount(): number {
		return this._arr.length;
	}

	public getIdForWhitespaceIndex(index: number): string {
		index = index | 0;

		return this._arr[index].id;
	}

	public getAfterLineNumberForWhitespaceIndex(index: number): number {
		index = index | 0;

		return this._arr[index].afterLineNumber;
	}

	public getHeightForWhitespaceIndex(index: number): number {
		index = index | 0;

		return this._arr[index].height;
	}
}
