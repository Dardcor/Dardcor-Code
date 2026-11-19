/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Selection } from '../core/selection.js';
import { ICommand, ICursorStateComputerData, IEditOperationBuilder } from '../editorCommon.js';
import { ITextModel } from '../model.js';

export class DardcorColumnPasteCommand implements ICommand {

	private readonly _range: Selection;
	private readonly _text: string;
	private readonly _overtype: boolean;

	constructor(range: Selection, text: string, overtype: boolean = false) {
		this._range = range;
		this._text = text;
		this._overtype = overtype;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		let range: Selection = this._range;
		if (this._overtype && range.isEmpty()) {
			const lineNumber = range.startLineNumber;
			const maxColumn = model.getLineMaxColumn(lineNumber);
			const endColumn = Math.min(maxColumn, range.startColumn + this._text.length);
			range = new Selection(lineNumber, range.startColumn, lineNumber, endColumn);
		}
		builder.addTrackedEditOperation(range, this._text);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		const srcRange = inverseEditOperations[0].range;
		return Selection.fromPositions(srcRange.getEndPosition());
	}
}
