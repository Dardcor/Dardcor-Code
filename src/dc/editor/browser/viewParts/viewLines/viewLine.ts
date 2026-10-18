/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as browser from '../../../../base/browser/browser.js';
import { FastDomNode, createFastDomNode } from '../../../../base/browser/fastDomNode.js';
import * as platform from '../../../../base/common/platform.js';
import { IVisibleLine } from '../../view/viewLayer.js';
import { RangeUtil } from './rangeUtil.js';
import { StringBuilder } from '../../../common/core/stringBuilder.js';
import { FloatHorizontalRange, VisibleRanges } from '../../view/renderingContext.js';
import { LineDecoration } from '../../../common/viewLayout/lineDecorations.js';
import { CharacterMapping, ForeignElementType, RenderLineInput, renderViewLine, DomPosition, RenderWhitespace } from '../../../common/viewLayout/viewLineRenderer.js';
import { ViewportData } from '../../../common/viewLayout/viewLinesViewportData.js';
import { isHighContrast } from '../../../../platform/theme/common/theme.js';
import { EditorFontLigatures } from '../../../common/config/editorOptions.js';
import { DomReadingContext } from './domReadingContext.js';
import type { ViewLineOptions } from './viewLineOptions.js';
import { ViewGpuContext } from '../../gpu/viewGpuContext.js';
import { OffsetRange } from '../../../common/core/ranges/offsetRange.js';
import { InlineDecorationType } from '../../../common/viewModel/inlineDecorations.js';
import { TextDirection } from '../../../common/model.js';

const canUseFastRenderedViewLine = (function () {
	if (platform.isNative) {
		return true;
	}

	if (platform.isLinux || browser.isFirefox || browser.isSafari) {
		return false;
	}

	return true;
})();

let monospaceAssumptionsAreValid = true;

export class ViewLine implements IVisibleLine {

	public static readonly CLASS_NAME = 'view-line';

	private _options: ViewLineOptions;
	private _isMaybeInvalid: boolean;
	private _renderedViewLine: IRenderedViewLine | null;

	constructor(private readonly _viewGpuContext: ViewGpuContext | undefined, options: ViewLineOptions) {
		this._options = options;
		this._isMaybeInvalid = true;
		this._renderedViewLine = null;
	}


	public getDomNode(): HTMLElement | null {
		if (this._renderedViewLine && this._renderedViewLine.domNode) {
			return this._renderedViewLine.domNode.domNode;
		}
		return null;
	}
	public setDomNode(domNode: HTMLElement): void {
		if (this._renderedViewLine) {
			this._renderedViewLine.domNode = createFastDomNode(domNode);
		} else {
			throw new Error('I have no rendered view line to set the dom node to...');
		}
	}

	public onContentChanged(): void {
		this._isMaybeInvalid = true;
	}
	public onTokensChanged(): void {
		this._isMaybeInvalid = true;
	}
	public onDecorationsChanged(): void {
		this._isMaybeInvalid = true;
	}
	public onOptionsChanged(newOptions: ViewLineOptions): void {
		this._isMaybeInvalid = true;
		this._options = newOptions;
	}
	public onSelectionChanged(): boolean {
		if (isHighContrast(this._options.themeType) || this._renderedViewLine?.input.renderWhitespace === RenderWhitespace.Selection) {
			this._isMaybeInvalid = true;
			return true;
		}
		return false;
	}

	public renderLine(lineNumber: number, deltaTop: number, lineHeight: number, viewportData: ViewportData, sb: StringBuilder): boolean {
		if (this._options.useGpu && this._viewGpuContext?.canRender(this._options, viewportData, lineNumber)) {
			this._renderedViewLine?.domNode?.domNode.remove();
			this._renderedViewLine = null;
			return false;
		}

		if (this._isMaybeInvalid === false) {
			return false;
		}

		this._isMaybeInvalid = false;

		const lineData = viewportData.getViewLineRenderingData(lineNumber);
		const options = this._options;
		const actualInlineDecorations = LineDecoration.filter(lineData.inlineDecorations, lineNumber, lineData.minColumn, lineData.maxColumn);
		const renderWhitespace = options.experimentalWhitespaceRendering === 'off' ? options.renderWhitespace : 'none';
		const allowFastRendering = !lineData.hasVariableFonts;

		let selectionsOnLine: OffsetRange[] | null = null;
		if (isHighContrast(options.themeType) || renderWhitespace === 'selection') {
			const selections = viewportData.selections;
			for (const selection of selections) {

				if (selection.endLineNumber < lineNumber || selection.startLineNumber > lineNumber) {
					continue;
				}

				const startColumn = (selection.startLineNumber === lineNumber ? selection.startColumn : lineData.minColumn);
				const endColumn = (selection.endLineNumber === lineNumber ? selection.endColumn : lineData.maxColumn);

				if (startColumn < endColumn) {
					if (isHighContrast(options.themeType)) {
						actualInlineDecorations.push(new LineDecoration(startColumn, endColumn, 'inline-selected-text', InlineDecorationType.Regular));
					}
					if (renderWhitespace === 'selection') {
						if (!selectionsOnLine) {
							selectionsOnLine = [];
						}

						selectionsOnLine.push(new OffsetRange(startColumn - 1, endColumn - 1));
					}
				}
			}
		}

		const renderLineInput = new RenderLineInput(
			options.useMonospaceOptimizations,
			options.canUseHalfwidthRightwardsArrow,
			lineData.content,
			lineData.continuesWithWrappedLine,
			lineData.isBasicASCII,
			lineData.containsRTL,
			lineData.minColumn - 1,
			lineData.tokens,
			actualInlineDecorations,
			lineData.tabSize,
			lineData.startVisibleColumn,
			options.spaceWidth,
			options.middotWidth,
			options.wsmiddotWidth,
			options.stopRenderingLineAfter,
			renderWhitespace,
			options.renderControlCharacters,
			options.fontLigatures !== EditorFontLigatures.OFF,
			selectionsOnLine,
			lineData.textDirection,
			options.verticalScrollbarSize
		);

		if (this._renderedViewLine && this._renderedViewLine.input.equals(renderLineInput)) {
			return false;
		}

		sb.appendString('<div ');
		if (lineData.textDirection === TextDirection.RTL) {
			sb.appendString('dir="rtl" ');
		} else if (lineData.containsRTL) {
			sb.appendString('dir="ltr" ');
		}
		sb.appendString('style="top:');
		sb.appendString(String(deltaTop));
		sb.appendString('px;height:');
		sb.appendString(String(lineHeight));
		sb.appendString('px;line-height:');
		sb.appendString(String(lineHeight));
		if (lineData.textDirection === TextDirection.RTL) {
			sb.appendString('px;padding-right:');
			sb.appendString(String(options.verticalScrollbarSize));
		}
		sb.appendString('px;" class="');
		sb.appendString(ViewLine.CLASS_NAME);
		sb.appendString('">');

		const output = renderViewLine(renderLineInput, sb);

		sb.appendString('</div>');

		let renderedViewLine: IRenderedViewLine | null = null;
		if (
			allowFastRendering
			&& monospaceAssumptionsAreValid
			&& canUseFastRenderedViewLine
			&& lineData.isBasicASCII
			&& renderLineInput.isLTR
			&& options.useMonospaceOptimizations
			&& output.containsForeignElements === ForeignElementType.None
		) {
			renderedViewLine = new FastRenderedViewLine(
				this._renderedViewLine ? this._renderedViewLine.domNode : null,
				renderLineInput,
				output.characterMapping
			);
		}

		if (!renderedViewLine) {
			renderedViewLine = createRenderedLine(
				this._renderedViewLine ? this._renderedViewLine.domNode : null,
				renderLineInput,
				output.characterMapping,
				output.containsForeignElements
			);
		}

		this._renderedViewLine = renderedViewLine;

		return true;
	}

	public layoutLine(lineNumber: number, deltaTop: number, lineHeight: number): void {
		if (this._renderedViewLine && this._renderedViewLine.domNode) {
			this._renderedViewLine.domNode.setTop(deltaTop);
			this._renderedViewLine.domNode.setHeight(lineHeight);
			this._renderedViewLine.domNode.setLineHeight(lineHeight);
		}
	}


	public isRenderedRTL(): boolean {
		if (!this._renderedViewLine) {
			return false;
		}
		return this._renderedViewLine.input.textDirection === TextDirection.RTL;
	}

	public getWidth(context: DomReadingContext | null): number {
		if (!this._renderedViewLine) {
			return 0;
		}
		return this._renderedViewLine.getWidth(context);
	}

	public getWidthIsFast(): boolean {
		if (!this._renderedViewLine) {
			return true;
		}
		return this._renderedViewLine.getWidthIsFast();
	}

	public needsMonospaceFontCheck(): boolean {
		if (!this._renderedViewLine) {
			return false;
		}
		return (this._renderedViewLine instanceof FastRenderedViewLine);
	}

	public monospaceAssumptionsAreValid(): boolean {
		if (!this._renderedViewLine) {
			return monospaceAssumptionsAreValid;
		}
		if (this._renderedViewLine instanceof FastRenderedViewLine) {
			return this._renderedViewLine.monospaceAssumptionsAreValid();
		}
		return monospaceAssumptionsAreValid;
	}

	public onMonospaceAssumptionsInvalidated(): void {
		if (this._renderedViewLine && this._renderedViewLine instanceof FastRenderedViewLine) {
			this._renderedViewLine = this._renderedViewLine.toSlowRenderedLine();
		}
	}

	public getVisibleRangesForRange(lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): VisibleRanges | null {
		if (!this._renderedViewLine) {
			return null;
		}

		startColumn = Math.min(this._renderedViewLine.input.lineContent.length + 1, Math.max(1, startColumn));
		endColumn = Math.min(this._renderedViewLine.input.lineContent.length + 1, Math.max(1, endColumn));

		const stopRenderingLineAfter = this._renderedViewLine.input.stopRenderingLineAfter;

		if (stopRenderingLineAfter !== -1 && startColumn > stopRenderingLineAfter + 1 && endColumn > stopRenderingLineAfter + 1) {
			return new VisibleRanges(true, [new FloatHorizontalRange(this.getWidth(context), 0)]);
		}

		if (stopRenderingLineAfter !== -1 && startColumn > stopRenderingLineAfter + 1) {
			startColumn = stopRenderingLineAfter + 1;
		}

		if (stopRenderingLineAfter !== -1 && endColumn > stopRenderingLineAfter + 1) {
			endColumn = stopRenderingLineAfter + 1;
		}

		const horizontalRanges = this._renderedViewLine.getVisibleRangesForRange(lineNumber, startColumn, endColumn, context);
		if (horizontalRanges && horizontalRanges.length > 0) {
			return new VisibleRanges(false, horizontalRanges);
		}

		return null;
	}

	public getColumnOfNodeOffset(spanNode: HTMLElement, offset: number): number {
		if (!this._renderedViewLine) {
			return 1;
		}
		return this._renderedViewLine.getColumnOfNodeOffset(spanNode, offset);
	}

	public resetCachedWidth(): void {
		this._renderedViewLine?.resetCachedWidth();
	}
}

interface IRenderedViewLine {
	domNode: FastDomNode<HTMLElement> | null;
	readonly input: RenderLineInput;
	getWidth(context: DomReadingContext | null): number;
	getWidthIsFast(): boolean;
	resetCachedWidth(): void;
	getVisibleRangesForRange(lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null;
	getColumnOfNodeOffset(spanNode: HTMLElement, offset: number): number;
}

const enum Constants {
	MaxMonospaceDistance = 300
}

class FastRenderedViewLine implements IRenderedViewLine {

	public domNode: FastDomNode<HTMLElement> | null;
	public readonly input: RenderLineInput;

	private readonly _characterMapping: CharacterMapping;
	private readonly _charWidth: number;
	private readonly _keyColumnPixelOffsetCache: Float32Array | null;
	private _cachedWidth: number = -1;

	constructor(domNode: FastDomNode<HTMLElement> | null, renderLineInput: RenderLineInput, characterMapping: CharacterMapping) {
		this.domNode = domNode;
		this.input = renderLineInput;
		const keyColumnCount = Math.floor(renderLineInput.lineContent.length / Constants.MaxMonospaceDistance);
		if (keyColumnCount > 0) {
			this._keyColumnPixelOffsetCache = new Float32Array(keyColumnCount);
			for (let i = 0; i < keyColumnCount; i++) {
				this._keyColumnPixelOffsetCache[i] = -1;
			}
		} else {
			this._keyColumnPixelOffsetCache = null;
		}

		this._characterMapping = characterMapping;
		this._charWidth = renderLineInput.spaceWidth;
	}

	public getWidth(context: DomReadingContext | null): number {
		if (!this.domNode || this.input.lineContent.length < Constants.MaxMonospaceDistance) {
			const horizontalOffset = this._characterMapping.getHorizontalOffset(this._characterMapping.length);
			return Math.round(this._charWidth * horizontalOffset);
		}
		if (this._cachedWidth === -1) {
			this._cachedWidth = this._getReadingTarget(this.domNode).offsetWidth;
			context?.markDidDomLayout();
		}
		return this._cachedWidth;
	}

	public getWidthIsFast(): boolean {
		return (this.input.lineContent.length < Constants.MaxMonospaceDistance) || this._cachedWidth !== -1;
	}

	public resetCachedWidth(): void {
		this._cachedWidth = -1;
	}

	public monospaceAssumptionsAreValid(): boolean {
		if (!this.domNode) {
			return monospaceAssumptionsAreValid;
		}
		if (this.input.lineContent.length < Constants.MaxMonospaceDistance) {
			const expectedWidth = this.getWidth(null);
			const actualWidth = (<HTMLSpanElement>this.domNode.domNode.firstChild).offsetWidth;
			if (Math.abs(expectedWidth - actualWidth) >= 2) {
				console.warn(`monospace assumptions have been violated, therefore disabling monospace optimizations!`);
				monospaceAssumptionsAreValid = false;
			}
		}
		return monospaceAssumptionsAreValid;
	}

	public toSlowRenderedLine(): RenderedViewLine {
		return createRenderedLine(this.domNode, this.input, this._characterMapping, ForeignElementType.None);
	}

	public getVisibleRangesForRange(lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null {
		const startPosition = this._getColumnPixelOffset(lineNumber, startColumn, context);
		const endPosition = this._getColumnPixelOffset(lineNumber, endColumn, context);
		return [new FloatHorizontalRange(startPosition, endPosition - startPosition)];
	}

	private _getColumnPixelOffset(lineNumber: number, column: number, context: DomReadingContext): number {
		if (column <= Constants.MaxMonospaceDistance) {
			const horizontalOffset = this._characterMapping.getHorizontalOffset(column);
			return this._charWidth * horizontalOffset;
		}

		const keyColumnOrdinal = Math.floor((column - 1) / Constants.MaxMonospaceDistance) - 1;
		const keyColumn = (keyColumnOrdinal + 1) * Constants.MaxMonospaceDistance + 1;
		let keyColumnPixelOffset = -1;
		if (this._keyColumnPixelOffsetCache) {
			keyColumnPixelOffset = this._keyColumnPixelOffsetCache[keyColumnOrdinal];
			if (keyColumnPixelOffset === -1) {
				keyColumnPixelOffset = this._actualReadPixelOffset(lineNumber, keyColumn, context);
				this._keyColumnPixelOffsetCache[keyColumnOrdinal] = keyColumnPixelOffset;
			}
		}

		if (keyColumnPixelOffset === -1) {
			const horizontalOffset = this._characterMapping.getHorizontalOffset(column);
			return this._charWidth * horizontalOffset;
		}

		const keyColumnHorizontalOffset = this._characterMapping.getHorizontalOffset(keyColumn);
		const horizontalOffset = this._characterMapping.getHorizontalOffset(column);
		return keyColumnPixelOffset + this._charWidth * (horizontalOffset - keyColumnHorizontalOffset);
	}

	private _getReadingTarget(myDomNode: FastDomNode<HTMLElement>): HTMLElement {
		return <HTMLSpanElement>myDomNode.domNode.firstChild;
	}

	private _actualReadPixelOffset(lineNumber: number, column: number, context: DomReadingContext): number {
		if (!this.domNode) {
			return -1;
		}
		const domPosition = this._characterMapping.getDomPosition(column);
		const r = RangeUtil.readHorizontalRanges(this._getReadingTarget(this.domNode), domPosition.partIndex, domPosition.charIndex, domPosition.partIndex, domPosition.charIndex, context);
		if (!r || r.length === 0) {
			return -1;
		}
		return r[0].left;
	}

	public getColumnOfNodeOffset(spanNode: HTMLElement, offset: number): number {
		return getColumnOfNodeOffset(this._characterMapping, spanNode, offset);
	}
}

class RenderedViewLine implements IRenderedViewLine {

	public domNode: FastDomNode<HTMLElement> | null;
	public readonly input: RenderLineInput;

	protected readonly _characterMapping: CharacterMapping;
	private readonly _isWhitespaceOnly: boolean;
	private readonly _containsForeignElements: ForeignElementType;
	private _cachedWidth: number;

	private readonly _pixelOffsetCache: Float32Array | null;

	constructor(domNode: FastDomNode<HTMLElement> | null, renderLineInput: RenderLineInput, characterMapping: CharacterMapping, containsForeignElements: ForeignElementType) {
		this.domNode = domNode;
		this.input = renderLineInput;
		this._characterMapping = characterMapping;
		this._isWhitespaceOnly = /^\s*$/.test(renderLineInput.lineContent);
		this._containsForeignElements = containsForeignElements;
		this._cachedWidth = -1;

		this._pixelOffsetCache = null;
		if (renderLineInput.isLTR) {
			this._pixelOffsetCache = new Float32Array(Math.max(2, this._characterMapping.length + 1));
			for (let column = 0, len = this._characterMapping.length; column <= len; column++) {
				this._pixelOffsetCache[column] = -1;
			}
		}
	}


	protected _getReadingTarget(myDomNode: FastDomNode<HTMLElement>): HTMLElement {
		return <HTMLSpanElement>myDomNode.domNode.firstChild;
	}

	public getWidth(context: DomReadingContext | null): number {
		if (!this.domNode) {
			return 0;
		}
		if (this._cachedWidth === -1) {
			this._cachedWidth = this._getReadingTarget(this.domNode).offsetWidth;
			context?.markDidDomLayout();
		}
		return this._cachedWidth;
	}

	public getWidthIsFast(): boolean {
		if (this._cachedWidth === -1) {
			return false;
		}
		return true;
	}

	public resetCachedWidth(): void {
		this._cachedWidth = -1;
		if (this._pixelOffsetCache !== null) {
			for (let column = 0, len = this._pixelOffsetCache.length; column < len; column++) {
				this._pixelOffsetCache[column] = -1;
			}
		}
	}

	public getVisibleRangesForRange(lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null {
		if (!this.domNode) {
			return null;
		}
		if (this._pixelOffsetCache !== null) {
			const startOffset = this._readPixelOffset(this.domNode, lineNumber, startColumn, context);
			if (startOffset === -1) {
				return null;
			}

			const endOffset = this._readPixelOffset(this.domNode, lineNumber, endColumn, context);
			if (endOffset === -1) {
				return null;
			}

			return [new FloatHorizontalRange(startOffset, endOffset - startOffset)];
		}

		return this._readVisibleRangesForRange(this.domNode, lineNumber, startColumn, endColumn, context);
	}

	protected _readVisibleRangesForRange(domNode: FastDomNode<HTMLElement>, lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null {
		if (startColumn === endColumn) {
			const pixelOffset = this._readPixelOffset(domNode, lineNumber, startColumn, context);
			if (pixelOffset === -1) {
				return null;
			} else {
				return [new FloatHorizontalRange(pixelOffset, 0)];
			}
		} else {
			return this._readRawVisibleRangesForRange(domNode, startColumn, endColumn, context);
		}
	}

	protected _readPixelOffset(domNode: FastDomNode<HTMLElement>, lineNumber: number, column: number, context: DomReadingContext): number {
		if (this.input.isLTR && this._characterMapping.length === 0) {
			if (this._containsForeignElements === ForeignElementType.None) {
				return 0;
			}
			if (this._containsForeignElements === ForeignElementType.After) {
				return 0;
			}
			if (this._containsForeignElements === ForeignElementType.Before) {
				return this.getWidth(context);
			}
			const readingTarget = this._getReadingTarget(domNode);
			if (readingTarget.firstChild) {
				context.markDidDomLayout();
				return (<HTMLSpanElement>readingTarget.firstChild).offsetWidth;
			} else {
				return 0;
			}
		}

		if (this._pixelOffsetCache !== null) {

			const cachedPixelOffset = this._pixelOffsetCache[column];
			if (cachedPixelOffset !== -1) {
				return cachedPixelOffset;
			}

			const result = this._actualReadPixelOffset(domNode, lineNumber, column, context);
			this._pixelOffsetCache[column] = result;
			return result;
		}

		return this._actualReadPixelOffset(domNode, lineNumber, column, context);
	}

	private _actualReadPixelOffset(domNode: FastDomNode<HTMLElement>, lineNumber: number, column: number, context: DomReadingContext): number {
		if (this._characterMapping.length === 0) {
			const r = RangeUtil.readHorizontalRanges(this._getReadingTarget(domNode), 0, 0, 0, 0, context);
			if (!r || r.length === 0) {
				return -1;
			}
			return r[0].left;
		}

		if (this.input.isLTR && column === this._characterMapping.length && this._isWhitespaceOnly && this._containsForeignElements === ForeignElementType.None) {
			return this.getWidth(context);
		}

		const domPosition = this._characterMapping.getDomPosition(column);

		const r = RangeUtil.readHorizontalRanges(this._getReadingTarget(domNode), domPosition.partIndex, domPosition.charIndex, domPosition.partIndex, domPosition.charIndex, context);
		if (!r || r.length === 0) {
			return -1;
		}
		const result = r[0].left;
		if (this.input.isBasicASCII) {
			const horizontalOffset = this._characterMapping.getHorizontalOffset(column);
			const expectedResult = Math.round(this.input.spaceWidth * horizontalOffset);
			if (Math.abs(expectedResult - result) <= 1) {
				return expectedResult;
			}
		}
		return result;
	}

	private _readRawVisibleRangesForRange(domNode: FastDomNode<HTMLElement>, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null {

		if (this.input.isLTR && startColumn === 1 && endColumn === this._characterMapping.length) {

			return [new FloatHorizontalRange(0, this.getWidth(context))];
		}

		const startDomPosition = this._characterMapping.getDomPosition(startColumn);
		const endDomPosition = this._characterMapping.getDomPosition(endColumn);

		return RangeUtil.readHorizontalRanges(this._getReadingTarget(domNode), startDomPosition.partIndex, startDomPosition.charIndex, endDomPosition.partIndex, endDomPosition.charIndex, context);
	}

	public getColumnOfNodeOffset(spanNode: HTMLElement, offset: number): number {
		return getColumnOfNodeOffset(this._characterMapping, spanNode, offset);
	}
}

class WebKitRenderedViewLine extends RenderedViewLine {
	protected override _readVisibleRangesForRange(domNode: FastDomNode<HTMLElement>, lineNumber: number, startColumn: number, endColumn: number, context: DomReadingContext): FloatHorizontalRange[] | null {
		const output = super._readVisibleRangesForRange(domNode, lineNumber, startColumn, endColumn, context);

		if (!output || output.length === 0 || startColumn === endColumn || (startColumn === 1 && endColumn === this._characterMapping.length)) {
			return output;
		}

		if (this.input.isLTR) {
			const endPixelOffset = this._readPixelOffset(domNode, lineNumber, endColumn, context);
			if (endPixelOffset !== -1) {
				const lastRange = output[output.length - 1];
				if (lastRange.left < endPixelOffset) {
					lastRange.width = endPixelOffset - lastRange.left;
				}
			}
		}

		return output;
	}
}

const createRenderedLine: (domNode: FastDomNode<HTMLElement> | null, renderLineInput: RenderLineInput, characterMapping: CharacterMapping, containsForeignElements: ForeignElementType) => RenderedViewLine = (function () {
	if (browser.isWebKit) {
		return createWebKitRenderedLine;
	}
	return createNormalRenderedLine;
})();

function createWebKitRenderedLine(domNode: FastDomNode<HTMLElement> | null, renderLineInput: RenderLineInput, characterMapping: CharacterMapping, containsForeignElements: ForeignElementType): RenderedViewLine {
	return new WebKitRenderedViewLine(domNode, renderLineInput, characterMapping, containsForeignElements);
}

function createNormalRenderedLine(domNode: FastDomNode<HTMLElement> | null, renderLineInput: RenderLineInput, characterMapping: CharacterMapping, containsForeignElements: ForeignElementType): RenderedViewLine {
	return new RenderedViewLine(domNode, renderLineInput, characterMapping, containsForeignElements);
}

export function getColumnOfNodeOffset(characterMapping: CharacterMapping, spanNode: HTMLElement, offset: number): number {
	const spanNodeTextContentLength = spanNode.textContent.length;

	let spanIndex = -1;
	while (spanNode) {
		spanNode = <HTMLElement>spanNode.previousSibling;
		spanIndex++;
	}

	return characterMapping.getColumn(new DomPosition(spanIndex, offset), spanNodeTextContentLength);
}
