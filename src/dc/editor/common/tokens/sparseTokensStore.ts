/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from '../../../base/common/arrays.js';
import { IRange, Range } from '../core/range.js';
import { LineTokens } from './lineTokens.js';
import { SparseMultilineTokens } from './sparseMultilineTokens.js';
import { ILanguageIdCodec } from '../languages.js';
import { MetadataConsts } from '../encodedTokenAttributes.js';
import { ITextModel } from '../model.js';

export class SparseTokensStore {

	private _pieces: SparseMultilineTokens[];
	private _isComplete: boolean;
	private readonly _languageIdCodec: ILanguageIdCodec;

	constructor(languageIdCodec: ILanguageIdCodec) {
		this._pieces = [];
		this._isComplete = false;
		this._languageIdCodec = languageIdCodec;
	}

	public flush(): void {
		this._pieces = [];
		this._isComplete = false;
	}

	public isEmpty(): boolean {
		return (this._pieces.length === 0);
	}

	public set(pieces: SparseMultilineTokens[] | null, isComplete: boolean, textModel: ITextModel | undefined = undefined): void {
		this._pieces = pieces || [];
		this._isComplete = isComplete;

		if (textModel) {
			for (const p of this._pieces) {
				p.reportIfInvalid(textModel);
			}
		}
	}

	public setPartial(_range: Range, pieces: SparseMultilineTokens[]): Range {

		let range = _range;
		if (pieces.length > 0) {
			const _firstRange = pieces[0].getRange();
			const _lastRange = pieces[pieces.length - 1].getRange();
			if (!_firstRange || !_lastRange) {
				return _range;
			}
			range = _range.plusRange(_firstRange).plusRange(_lastRange);
		}

		let insertPosition: { index: number } | null = null;
		for (let i = 0, len = this._pieces.length; i < len; i++) {
			const piece = this._pieces[i];
			if (piece.endLineNumber < range.startLineNumber) {
				continue;
			}

			if (piece.startLineNumber > range.endLineNumber) {
				insertPosition = insertPosition || { index: i };
				break;
			}

			piece.removeTokens(range);

			if (piece.isEmpty()) {
				this._pieces.splice(i, 1);
				i--;
				len--;
				continue;
			}

			if (piece.endLineNumber < range.startLineNumber) {
				continue;
			}

			if (piece.startLineNumber > range.endLineNumber) {
				insertPosition = insertPosition || { index: i };
				continue;
			}

			const [a, b] = piece.split(range);
			if (a.isEmpty()) {
				insertPosition = insertPosition || { index: i };
				continue;
			}
			if (b.isEmpty()) {
				continue;
			}
			this._pieces.splice(i, 1, a, b);
			i++;
			len++;

			insertPosition = insertPosition || { index: i };
		}

		insertPosition = insertPosition || { index: this._pieces.length };

		if (pieces.length > 0) {
			this._pieces = arrays.arrayInsert(this._pieces, insertPosition.index, pieces);
		}


		return range;
	}

	public isComplete(): boolean {
		return this._isComplete;
	}

	public addSparseTokens(lineNumber: number, aTokens: LineTokens): LineTokens {
		if (aTokens.getTextLength() === 0) {
			return aTokens;
		}

		const pieces = this._pieces;

		if (pieces.length === 0) {
			return aTokens;
		}

		const pieceIndex = SparseTokensStore._findFirstPieceWithLine(pieces, lineNumber);
		const bTokens = pieces[pieceIndex].getLineTokens(lineNumber);

		if (!bTokens) {
			return aTokens;
		}

		const aLen = aTokens.getCount();
		const bLen = bTokens.getCount();

		let aIndex = 0;
		const result: number[] = [];
		let resultLen = 0;
		let lastEndOffset = 0;

		const emitToken = (endOffset: number, metadata: number) => {
			if (endOffset <= lastEndOffset) {
				return;
			}
			lastEndOffset = endOffset;
			result[resultLen++] = endOffset;
			result[resultLen++] = metadata;
		};

		for (let bIndex = 0; bIndex < bLen; bIndex++) {
			const bStartCharacter = Math.min(bTokens.getStartCharacter(bIndex), aTokens.getTextLength());
			const bEndCharacter = Math.min(bTokens.getEndCharacter(bIndex), aTokens.getTextLength());
			const bMetadata = bTokens.getMetadata(bIndex);

			const bMask = (
				((bMetadata & MetadataConsts.SEMANTIC_USE_ITALIC) ? MetadataConsts.ITALIC_MASK : 0)
				| ((bMetadata & MetadataConsts.SEMANTIC_USE_BOLD) ? MetadataConsts.BOLD_MASK : 0)
				| ((bMetadata & MetadataConsts.SEMANTIC_USE_UNDERLINE) ? MetadataConsts.UNDERLINE_MASK : 0)
				| ((bMetadata & MetadataConsts.SEMANTIC_USE_STRIKETHROUGH) ? MetadataConsts.STRIKETHROUGH_MASK : 0)
				| ((bMetadata & MetadataConsts.SEMANTIC_USE_FOREGROUND) ? MetadataConsts.FOREGROUND_MASK : 0)
				| ((bMetadata & MetadataConsts.SEMANTIC_USE_BACKGROUND) ? MetadataConsts.BACKGROUND_MASK : 0)
			) >>> 0;
			const aMask = (~bMask) >>> 0;

			while (aIndex < aLen && aTokens.getEndOffset(aIndex) <= bStartCharacter) {
				emitToken(aTokens.getEndOffset(aIndex), aTokens.getMetadata(aIndex));
				aIndex++;
			}

			if (aIndex < aLen && aTokens.getStartOffset(aIndex) < bStartCharacter) {
				emitToken(bStartCharacter, aTokens.getMetadata(aIndex));
			}

			while (aIndex < aLen && aTokens.getEndOffset(aIndex) < bEndCharacter) {
				emitToken(aTokens.getEndOffset(aIndex), (aTokens.getMetadata(aIndex) & aMask) | (bMetadata & bMask));
				aIndex++;
			}

			if (aIndex < aLen) {
				emitToken(bEndCharacter, (aTokens.getMetadata(aIndex) & aMask) | (bMetadata & bMask));
				if (aTokens.getEndOffset(aIndex) === bEndCharacter) {
					aIndex++;
				}
			} else {
				const aMergeIndex = Math.min(Math.max(0, aIndex - 1), aLen - 1);

				emitToken(bEndCharacter, (aTokens.getMetadata(aMergeIndex) & aMask) | (bMetadata & bMask));
			}
		}

		while (aIndex < aLen) {
			emitToken(aTokens.getEndOffset(aIndex), aTokens.getMetadata(aIndex));
			aIndex++;
		}

		return new LineTokens(new Uint32Array(result), aTokens.getLineContent(), this._languageIdCodec);
	}

	private static _findFirstPieceWithLine(pieces: SparseMultilineTokens[], lineNumber: number): number {
		let low = 0;
		let high = pieces.length - 1;

		while (low < high) {
			let mid = low + Math.floor((high - low) / 2);

			if (pieces[mid].endLineNumber < lineNumber) {
				low = mid + 1;
			} else if (pieces[mid].startLineNumber > lineNumber) {
				high = mid - 1;
			} else {
				while (mid > low && pieces[mid - 1].startLineNumber <= lineNumber && lineNumber <= pieces[mid - 1].endLineNumber) {
					mid--;
				}
				return mid;
			}
		}

		return low;
	}

	public acceptEdit(range: IRange, eolCount: number, firstLineLength: number, lastLineLength: number, firstCharCode: number): void {
		for (let i = 0; i < this._pieces.length; i++) {
			const piece = this._pieces[i];
			piece.acceptEdit(range, eolCount, firstLineLength, lastLineLength, firstCharCode);

			if (piece.isEmpty()) {
				this._pieces.splice(i, 1);
				i--;
			}
		}
	}
}
