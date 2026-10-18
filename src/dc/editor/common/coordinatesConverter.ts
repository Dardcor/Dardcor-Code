/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from './core/position.js';
import { Range } from './core/range.js';
import { ITextModel, PositionAffinity } from './model.js';

export interface ICoordinatesConverter {
	convertViewPositionToModelPosition(viewPosition: Position): Position;
	convertViewRangeToModelRange(viewRange: Range): Range;
	validateViewPosition(viewPosition: Position, expectedModelPosition: Position): Position;
	validateViewRange(viewRange: Range, expectedModelRange: Range): Range;

	convertModelPositionToViewPosition(modelPosition: Position, affinity?: PositionAffinity, allowZeroLineNumber?: boolean, belowHiddenRanges?: boolean): Position;
	convertModelRangeToViewRange(modelRange: Range, affinity?: PositionAffinity): Range;
	modelPositionIsVisible(modelPosition: Position): boolean;
	getModelLineViewLineCount(modelLineNumber: number): number;
	getViewLineNumberOfModelPosition(modelLineNumber: number, modelColumn: number): number;
}

export class IdentityCoordinatesConverter implements ICoordinatesConverter {

	private readonly _model: ITextModel;

	constructor(model: ITextModel) {
		this._model = model;
	}

	private _validPosition(pos: Position): Position {
		return this._model.validatePosition(pos);
	}

	private _validRange(range: Range): Range {
		return this._model.validateRange(range);
	}


	public convertViewPositionToModelPosition(viewPosition: Position): Position {
		return this._validPosition(viewPosition);
	}

	public convertViewRangeToModelRange(viewRange: Range): Range {
		return this._validRange(viewRange);
	}

	public validateViewPosition(_viewPosition: Position, expectedModelPosition: Position): Position {
		return this._validPosition(expectedModelPosition);
	}

	public validateViewRange(_viewRange: Range, expectedModelRange: Range): Range {
		return this._validRange(expectedModelRange);
	}


	public convertModelPositionToViewPosition(modelPosition: Position): Position {
		return this._validPosition(modelPosition);
	}

	public convertModelRangeToViewRange(modelRange: Range): Range {
		return this._validRange(modelRange);
	}

	public modelPositionIsVisible(modelPosition: Position): boolean {
		const lineCount = this._model.getLineCount();
		if (modelPosition.lineNumber < 1 || modelPosition.lineNumber > lineCount) {
			return false;
		}
		return true;
	}

	public modelRangeIsVisible(modelRange: Range): boolean {
		const lineCount = this._model.getLineCount();
		if (modelRange.startLineNumber < 1 || modelRange.startLineNumber > lineCount) {
			return false;
		}
		if (modelRange.endLineNumber < 1 || modelRange.endLineNumber > lineCount) {
			return false;
		}
		return true;
	}

	public getModelLineViewLineCount(modelLineNumber: number): number {
		return 1;
	}

	public getViewLineNumberOfModelPosition(modelLineNumber: number, modelColumn: number): number {
		return modelLineNumber;
	}
}
