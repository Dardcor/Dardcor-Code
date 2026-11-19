/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './wordWrapIndicator.css';
import { DynamicViewOverlay } from '../../view/dynamicViewOverlay.js';
import { RenderingContext } from '../../view/renderingContext.js';
import { ViewContext } from '../../../common/viewModel/viewContext.js';
import * as viewEvents from '../../../common/viewEvents.js';
import { Position } from '../../../common/core/position.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { IEditorConfiguration } from '../../../common/config/editorConfiguration.js';

const WORD_WRAP_INDICATOR_CHAR_CODE = 0x21A9;

export class WordWrapIndicatorOverlay extends DynamicViewOverlay {

	private readonly _context: ViewContext;
	private _options: WordWrapIndicatorOptions;
	private _renderResult: string[] | null;

	constructor(context: ViewContext) {
		super();
		this._context = context;
		this._options = new WordWrapIndicatorOptions(this._context.configuration);
		this._renderResult = null;
		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		this._renderResult = null;
		super.dispose();
	}

	private get _isEnabled(): boolean {
		return this._options.wordWrapIndicator && this._options.isWrapping;
	}

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const wasEnabled = this._isEnabled;
		const newOptions = new WordWrapIndicatorOptions(this._context.configuration);
		const optionsChanged = !this._options.equals(newOptions);
		this._options = newOptions;
		return (wasEnabled || this._isEnabled) && optionsChanged;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		return this._isEnabled;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return this._isEnabled;
	}
	public override onLineMappingChanged(e: viewEvents.ViewLineMappingChangedEvent): boolean {
		return this._isEnabled;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return this._isEnabled;
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return this._isEnabled;
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return this._isEnabled;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return this._isEnabled && e.scrollTopChanged;
	}
	public override onTokensChanged(e: viewEvents.ViewTokensChangedEvent): boolean {
		return false;
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return this._isEnabled;
	}

	public prepareRender(ctx: RenderingContext): void {
		if (!this._isEnabled) {
			this._renderResult = null;
			return;
		}
		this._renderResult = [];
		for (let lineNumber = ctx.viewportData.startLineNumber; lineNumber <= ctx.viewportData.endLineNumber; lineNumber++) {
			const lineIndex = lineNumber - ctx.viewportData.startLineNumber;
			this._renderResult[lineIndex] = this._renderLine(ctx, lineNumber);
		}
	}

	private _getViewLineContinuesWithWrappedLine(lineNumber: number): boolean {
		const model = this._context.viewModel;
		if (lineNumber >= model.getLineCount()) {
			return false;
		}
		const currentModelLine = model.coordinatesConverter.convertViewPositionToModelPosition(new Position(lineNumber, 1)).lineNumber;
		const nextModelLine = model.coordinatesConverter.convertViewPositionToModelPosition(new Position(lineNumber + 1, 1)).lineNumber;
		return currentModelLine === nextModelLine;
	}

	private _renderLine(ctx: RenderingContext, lineNumber: number): string {
		if (!this._getViewLineContinuesWithWrappedLine(lineNumber)) {
			return '';
		}
		const lineHeight = ctx.getLineHeightForLineNumber(lineNumber);
		return `<div class="wwi" style="left:${this._options.indicatorLeft}px;height:${lineHeight}px;">${String.fromCharCode(WORD_WRAP_INDICATOR_CHAR_CODE)}</div>`;
	}

	public render(startLineNumber: number, lineNumber: number): string {
		if (!this._renderResult) {
			return '';
		}
		const lineIndex = lineNumber - startLineNumber;
		if (lineIndex < 0 || lineIndex >= this._renderResult.length) {
			return '';
		}
		return this._renderResult[lineIndex];
	}
}

class WordWrapIndicatorOptions {
	public readonly wordWrapIndicator: boolean;
	public readonly isWrapping: boolean;
	public readonly indicatorLeft: number;

	constructor(config: IEditorConfiguration) {
		const options = config.options;
		const fontInfo = options.get(EditorOption.fontInfo);
		const wrappingColumn = options.get(EditorOption.wrappingInfo).wrappingColumn;
		this.wordWrapIndicator = options.get(EditorOption.wordWrapIndicator);
		this.isWrapping = wrappingColumn !== -1;
		this.indicatorLeft = wrappingColumn * fontInfo.typicalHalfwidthCharacterWidth;
	}

	public equals(other: WordWrapIndicatorOptions): boolean {
		return (
			this.wordWrapIndicator === other.wordWrapIndicator
			&& this.isWrapping === other.isWrapping
			&& this.indicatorLeft === other.indicatorLeft
		);
	}
}
