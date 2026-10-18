/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { splitLines } from '../../../base/common/strings.js';
import { URI } from '../../../base/common/uri.js';
import { Position } from '../core/position.js';
import { IRange } from '../core/range.js';
import { PrefixSumComputer } from './prefixSumComputer.js';

export interface IModelContentChange {
	readonly range: IRange;
	readonly rangeOffset: number;
	readonly rangeLength: number;
	readonly text: string;
}

export interface IModelChangedEvent {
	readonly changes: IModelContentChange[];
	readonly eol: string;
	readonly versionId: number;
	readonly isUndoing: boolean;
	readonly isRedoing: boolean;
}

export interface IMirrorTextModel {
	readonly version: number;
}

export class MirrorTextModel implements IMirrorTextModel {

	protected _uri: URI;
	protected _lines: string[];
	protected _eol: string;
	protected _versionId: number;
	protected _lineStarts: PrefixSumComputer | null;
	private _cachedTextValue: string | null;

	constructor(uri: URI, lines: string[], eol: string, versionId: number) {
		this._uri = uri;
		this._lines = lines;
		this._eol = eol;
		this._versionId = versionId;
		this._lineStarts = null;
		this._cachedTextValue = null;
	}

	dispose(): void {
		this._lines.length = 0;
	}

	get version(): number {
		return this._versionId;
	}

	getText(): string {
		if (this._cachedTextValue === null) {
			this._cachedTextValue = this._lines.join(this._eol);
		}
		return this._cachedTextValue;
	}

	onEvents(e: IModelChangedEvent): void {
		if (e.eol && e.eol !== this._eol) {
			this._eol = e.eol;
			this._lineStarts = null;
		}

		const changes = e.changes;
		for (const change of changes) {
			this._acceptDeleteRange(change.range);
			this._acceptInsertText(new Position(change.range.startLineNumber, change.range.startColumn), change.text);
		}

		this._versionId = e.versionId;
		this._cachedTextValue = null;
	}

	protected _ensureLineStarts(): void {
		if (!this._lineStarts) {
			const eolLength = this._eol.length;
			const linesLength = this._lines.length;
			const lineStartValues = new Uint32Array(linesLength);
			for (let i = 0; i < linesLength; i++) {
				lineStartValues[i] = this._lines[i].length + eolLength;
			}
			this._lineStarts = new PrefixSumComputer(lineStartValues);
		}
	}

	private _setLineText(lineIndex: number, newValue: string): void {
		this._lines[lineIndex] = newValue;
		if (this._lineStarts) {
			this._lineStarts.setValue(lineIndex, this._lines[lineIndex].length + this._eol.length);
		}
	}

	private _acceptDeleteRange(range: IRange): void {

		if (range.startLineNumber === range.endLineNumber) {
			if (range.startColumn === range.endColumn) {
				return;
			}
			this._setLineText(range.startLineNumber - 1,
				this._lines[range.startLineNumber - 1].substring(0, range.startColumn - 1)
				+ this._lines[range.startLineNumber - 1].substring(range.endColumn - 1)
			);
			return;
		}

		this._setLineText(range.startLineNumber - 1,
			this._lines[range.startLineNumber - 1].substring(0, range.startColumn - 1)
			+ this._lines[range.endLineNumber - 1].substring(range.endColumn - 1)
		);

		this._lines.splice(range.startLineNumber, range.endLineNumber - range.startLineNumber);
		if (this._lineStarts) {
			this._lineStarts.removeValues(range.startLineNumber, range.endLineNumber - range.startLineNumber);
		}
	}

	private _acceptInsertText(position: Position, insertText: string): void {
		if (insertText.length === 0) {
			return;
		}
		const insertLines = splitLines(insertText);
		if (insertLines.length === 1) {
			this._setLineText(position.lineNumber - 1,
				this._lines[position.lineNumber - 1].substring(0, position.column - 1)
				+ insertLines[0]
				+ this._lines[position.lineNumber - 1].substring(position.column - 1)
			);
			return;
		}

		insertLines[insertLines.length - 1] += this._lines[position.lineNumber - 1].substring(position.column - 1);

		this._setLineText(position.lineNumber - 1,
			this._lines[position.lineNumber - 1].substring(0, position.column - 1)
			+ insertLines[0]
		);

		const newLengths = new Uint32Array(insertLines.length - 1);
		for (let i = 1; i < insertLines.length; i++) {
			this._lines.splice(position.lineNumber + i - 1, 0, insertLines[i]);
			newLengths[i - 1] = insertLines[i].length + this._eol.length;
		}

		if (this._lineStarts) {
			this._lineStarts.insertValues(position.lineNumber, newLengths);
		}
	}
}
