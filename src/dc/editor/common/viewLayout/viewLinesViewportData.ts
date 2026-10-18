/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../core/range.js';
import { Selection } from '../core/selection.js';
import { IPartialViewLinesViewportData, IViewModel, IViewWhitespaceViewportData, ViewLineRenderingData } from '../viewModel.js';
import { ViewModelDecoration } from '../viewModel/viewModelDecoration.js';

export class ViewportData {

	public readonly selections: Selection[];

	public readonly startLineNumber: number;

	public readonly endLineNumber: number;

	public readonly relativeVerticalOffset: number[];

	public readonly visibleRange: Range;

	public readonly bigNumbersDelta: number;

	public readonly whitespaceViewportData: IViewWhitespaceViewportData[];

	private readonly _model: IViewModel;

	public readonly lineHeight: number;

	constructor(
		selections: Selection[],
		partialData: IPartialViewLinesViewportData,
		whitespaceViewportData: IViewWhitespaceViewportData[],
		model: IViewModel
	) {
		this.selections = selections;
		this.startLineNumber = partialData.startLineNumber | 0;
		this.endLineNumber = partialData.endLineNumber | 0;
		this.relativeVerticalOffset = partialData.relativeVerticalOffset;
		this.bigNumbersDelta = partialData.bigNumbersDelta | 0;
		this.lineHeight = partialData.lineHeight | 0;
		this.whitespaceViewportData = whitespaceViewportData;

		this._model = model;

		this.visibleRange = new Range(
			partialData.startLineNumber,
			this._model.getLineMinColumn(partialData.startLineNumber),
			partialData.endLineNumber,
			this._model.getLineMaxColumn(partialData.endLineNumber)
		);
	}

	public getViewLineRenderingData(lineNumber: number): ViewLineRenderingData {
		return this._model.getViewportViewLineRenderingData(this.visibleRange, lineNumber);
	}

	public getDecorationsInViewport(): ViewModelDecoration[] {
		return this._model.getDecorationsInViewport(this.visibleRange);
	}
}
