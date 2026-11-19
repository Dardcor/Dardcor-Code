/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IBufferDirtyTrackerReader {
	readonly dataOffset: number | undefined;
	readonly dirtySize: number | undefined;
	readonly isDirty: boolean;
	clear(): void;
}

export class BufferDirtyTracker implements IBufferDirtyTrackerReader {

	private _startIndex: number | undefined;
	private _endIndex: number | undefined;

	get dataOffset(): number | undefined {
		return this._startIndex;
	}

	get dirtySize(): number | undefined {
		if (this._startIndex === undefined || this._endIndex === undefined) {
			return undefined;
		}
		return this._endIndex - this._startIndex + 1;
	}

	get isDirty(): boolean { return this._startIndex !== undefined; }

	flag(index: number, length: number = 1): number {
		this._flag(index);
		if (length > 1) {
			this._flag(index + length - 1);
		}
		return index;
	}

	private _flag(index: number) {
		if (this._startIndex === undefined || index < this._startIndex) {
			this._startIndex = index;
		}
		if (this._endIndex === undefined || index > this._endIndex) {
			this._endIndex = index;
		}
	}

	clear() {
		this._startIndex = undefined;
		this._endIndex = undefined;
	}
}
