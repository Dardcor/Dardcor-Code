/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FastDomNode } from '../../../../base/browser/fastDomNode.js';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from '../../../../base/browser/ui/mouseCursor/mouseCursor.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import * as platform from '../../../../base/common/platform.js';
import { Constants } from '../../../../base/common/uint.js';
import './viewLines.css';
import { applyFontInfo } from '../../config/domFontInfo.js';
import { HorizontalPosition, HorizontalRange, IViewLines, LineVisibleRanges, VisibleRanges } from '../../view/renderingContext.js';
import { VisibleLinesCollection } from '../../view/viewLayer.js';
import { PartFingerprint, PartFingerprints, ViewPart } from '../../view/viewPart.js';
import { DomReadingContext } from './domReadingContext.js';
import { ViewLine } from './viewLine.js';
import { EditorOption } from '../../../common/config/editorOptions.js';
import { Position } from '../../../common/core/position.js';
import { Range } from '../../../common/core/range.js';
import { Selection } from '../../../common/core/selection.js';
import { ScrollType } from '../../../common/editorCommon.js';
import * as viewEvents from '../../../common/viewEvents.js';
import { ViewportData } from '../../../common/viewLayout/viewLinesViewportData.js';
import { Viewport } from '../../../common/viewModel.js';
import { ViewContext } from '../../../common/viewModel/viewContext.js';
import { ViewLineOptions } from './viewLineOptions.js';
import type { ViewGpuContext } from '../../gpu/viewGpuContext.js';
import { TextDirection } from '../../../common/model.js';

class LastRenderedData {

	private _currentVisibleRange: Range;

	constructor() {
		this._currentVisibleRange = new Range(1, 1, 1, 1);
	}

	public getCurrentVisibleRange(): Range {
		return this._currentVisibleRange;
	}

	public setCurrentVisibleRange(currentVisibleRange: Range): void {
		this._currentVisibleRange = currentVisibleRange;
	}
}

class HorizontalRevealRangeRequest {
	public readonly type = 'range';
	public readonly minLineNumber: number;
	public readonly maxLineNumber: number;

	constructor(
		public readonly minimalReveal: boolean,
		public readonly lineNumber: number,
		public readonly startColumn: number,
		public readonly endColumn: number,
		public readonly startScrollTop: number,
		public readonly stopScrollTop: number,
		public readonly scrollType: ScrollType
	) {
		this.minLineNumber = lineNumber;
		this.maxLineNumber = lineNumber;
	}
}

class HorizontalRevealSelectionsRequest {
	public readonly type = 'selections';
	public readonly minLineNumber: number;
	public readonly maxLineNumber: number;

	constructor(
		public readonly minimalReveal: boolean,
		public readonly selections: Selection[],
		public readonly startScrollTop: number,
		public readonly stopScrollTop: number,
		public readonly scrollType: ScrollType
	) {
		let minLineNumber = selections[0].startLineNumber;
		let maxLineNumber = selections[0].endLineNumber;
		for (let i = 1, len = selections.length; i < len; i++) {
			const selection = selections[i];
			minLineNumber = Math.min(minLineNumber, selection.startLineNumber);
			maxLineNumber = Math.max(maxLineNumber, selection.endLineNumber);
		}
		this.minLineNumber = minLineNumber;
		this.maxLineNumber = maxLineNumber;
	}
}

type HorizontalRevealRequest = HorizontalRevealRangeRequest | HorizontalRevealSelectionsRequest;

export class ViewLines extends ViewPart implements IViewLines {
	private static readonly HORIZONTAL_EXTRA_PX = 30;

	private readonly _linesContent: FastDomNode<HTMLElement>;
	private readonly _textRangeRestingSpot: HTMLElement;
	private readonly _visibleLines: VisibleLinesCollection<ViewLine>;
	private readonly domNode: FastDomNode<HTMLElement>;

	private _lineHeight: number;
	private _typicalHalfwidthCharacterWidth: number;
	private _isViewportWrapping: boolean;
	private _revealHorizontalRightPadding: number;
	private _cursorSurroundingLines: number;
	private _cursorSurroundingLinesStyle: 'default' | 'all';
	private _canUseLayerHinting: boolean;
	private _viewLineOptions: ViewLineOptions;

	private _maxLineWidth: number;
	private readonly _asyncUpdateLineWidths: RunOnceScheduler;
	private readonly _asyncCheckMonospaceFontAssumptions: RunOnceScheduler;

	private _horizontalRevealRequest: HorizontalRevealRequest | null;
	private readonly _lastRenderedData: LastRenderedData;

	private _stickyScrollEnabled: boolean;
	private _maxNumberStickyLines: number;

	constructor(context: ViewContext, viewGpuContext: ViewGpuContext | undefined, linesContent: FastDomNode<HTMLElement>) {
		super(context);

		const conf = this._context.configuration;
		const options = this._context.configuration.options;
		const fontInfo = options.get(EditorOption.fontInfo);
		const wrappingInfo = options.get(EditorOption.wrappingInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		this._isViewportWrapping = wrappingInfo.isViewportWrapping;
		this._revealHorizontalRightPadding = options.get(EditorOption.revealHorizontalRightPadding);
		this._cursorSurroundingLines = options.get(EditorOption.cursorSurroundingLines);
		this._cursorSurroundingLinesStyle = options.get(EditorOption.cursorSurroundingLinesStyle);
		this._canUseLayerHinting = !options.get(EditorOption.disableLayerHinting);
		this._viewLineOptions = new ViewLineOptions(conf, this._context.theme.type);

		this._linesContent = linesContent;
		this._textRangeRestingSpot = document.createElement('div');
		this._visibleLines = new VisibleLinesCollection(this._context, {
			createLine: () => new ViewLine(viewGpuContext, this._viewLineOptions),
		});
		this.domNode = this._visibleLines.domNode;

		PartFingerprints.write(this.domNode, PartFingerprint.ViewLines);
		this.domNode.setClassName(`view-lines ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`);
		applyFontInfo(this.domNode, fontInfo);

		this._maxLineWidth = 0;
		this._asyncUpdateLineWidths = new RunOnceScheduler(() => {
			this._updateLineWidthsSlow();
		}, 200);
		this._asyncCheckMonospaceFontAssumptions = new RunOnceScheduler(() => {
			this._checkMonospaceFontAssumptions();
		}, 2000);

		this._lastRenderedData = new LastRenderedData();

		this._horizontalRevealRequest = null;

		this._stickyScrollEnabled = options.get(EditorOption.stickyScroll).enabled;
		this._maxNumberStickyLines = options.get(EditorOption.stickyScroll).maxLineCount;
	}

	public override dispose(): void {
		this._asyncUpdateLineWidths.dispose();
		this._asyncCheckMonospaceFontAssumptions.dispose();
		super.dispose();
	}

	public getDomNode(): FastDomNode<HTMLElement> {
		return this.domNode;
	}


	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		this._visibleLines.onConfigurationChanged(e);
		if (e.hasChanged(EditorOption.wrappingInfo)) {
			this._maxLineWidth = 0;
		}

		const options = this._context.configuration.options;
		const fontInfo = options.get(EditorOption.fontInfo);
		const wrappingInfo = options.get(EditorOption.wrappingInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._typicalHalfwidthCharacterWidth = fontInfo.typicalHalfwidthCharacterWidth;
		this._isViewportWrapping = wrappingInfo.isViewportWrapping;
		this._revealHorizontalRightPadding = options.get(EditorOption.revealHorizontalRightPadding);
		this._cursorSurroundingLines = options.get(EditorOption.cursorSurroundingLines);
		this._cursorSurroundingLinesStyle = options.get(EditorOption.cursorSurroundingLinesStyle);
		this._canUseLayerHinting = !options.get(EditorOption.disableLayerHinting);

		this._stickyScrollEnabled = options.get(EditorOption.stickyScroll).enabled;
		this._maxNumberStickyLines = options.get(EditorOption.stickyScroll).maxLineCount;

		applyFontInfo(this.domNode, fontInfo);

		this._onOptionsMaybeChanged();

		if (e.hasChanged(EditorOption.layoutInfo)) {
			this._maxLineWidth = 0;
		}

		return true;
	}
	private _onOptionsMaybeChanged(): boolean {
		const conf = this._context.configuration;

		const newViewLineOptions = new ViewLineOptions(conf, this._context.theme.type);
		if (!this._viewLineOptions.equals(newViewLineOptions)) {
			this._viewLineOptions = newViewLineOptions;

			const startLineNumber = this._visibleLines.getStartLineNumber();
			const endLineNumber = this._visibleLines.getEndLineNumber();
			for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
				const line = this._visibleLines.getVisibleLine(lineNumber);
				line.onOptionsChanged(this._viewLineOptions);
			}
			return true;
		}

		return false;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		let r = false;
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			r = this._visibleLines.getVisibleLine(lineNumber).onSelectionChanged() || r;
		}
		return r;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			this._visibleLines.getVisibleLine(lineNumber).onDecorationsChanged();
		}
		return true;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		const shouldRender = this._visibleLines.onFlushed(e, this._viewLineOptions.useGpu);
		this._maxLineWidth = 0;
		return shouldRender;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return this._visibleLines.onLinesChanged(e);
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return this._visibleLines.onLinesDeleted(e);
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return this._visibleLines.onLinesInserted(e);
	}
	public override onRevealRangeRequest(e: viewEvents.ViewRevealRangeRequestEvent): boolean {
		const desiredScrollTop = this._computeScrollTopToRevealRange(this._context.viewLayout.getFutureViewport(), e.source, e.minimalReveal, e.range, e.selections, e.verticalType);

		if (desiredScrollTop === -1) {
			return false;
		}

		let newScrollPosition = this._context.viewLayout.validateScrollPosition({ scrollTop: desiredScrollTop });

		if (e.revealHorizontal) {
			if (e.range && e.range.startLineNumber !== e.range.endLineNumber) {
				newScrollPosition = {
					scrollTop: newScrollPosition.scrollTop,
					scrollLeft: 0
				};
			} else if (e.range) {
				this._horizontalRevealRequest = new HorizontalRevealRangeRequest(e.minimalReveal, e.range.startLineNumber, e.range.startColumn, e.range.endColumn, this._context.viewLayout.getCurrentScrollTop(), newScrollPosition.scrollTop, e.scrollType);
			} else if (e.selections && e.selections.length > 0) {
				this._horizontalRevealRequest = new HorizontalRevealSelectionsRequest(e.minimalReveal, e.selections, this._context.viewLayout.getCurrentScrollTop(), newScrollPosition.scrollTop, e.scrollType);
			}
		} else {
			this._horizontalRevealRequest = null;
		}

		const scrollTopDelta = Math.abs(this._context.viewLayout.getCurrentScrollTop() - newScrollPosition.scrollTop);
		const scrollType = (scrollTopDelta <= this._lineHeight ? ScrollType.Immediate : e.scrollType);
		this._context.viewModel.viewLayout.setScrollPosition(newScrollPosition, scrollType);

		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		if (this._horizontalRevealRequest && e.scrollLeftChanged) {
			this._horizontalRevealRequest = null;
		}
		if (this._horizontalRevealRequest && e.scrollTopChanged) {
			const min = Math.min(this._horizontalRevealRequest.startScrollTop, this._horizontalRevealRequest.stopScrollTop);
			const max = Math.max(this._horizontalRevealRequest.startScrollTop, this._horizontalRevealRequest.stopScrollTop);
			if (e.scrollTop < min || e.scrollTop > max) {
				this._horizontalRevealRequest = null;
			}
		}
		this.domNode.setWidth(e.scrollWidth);
		return this._visibleLines.onScrollChanged(e) || e.scrollTopChanged || e.scrollLeftChanged;
	}

	public override onTokensChanged(e: viewEvents.ViewTokensChangedEvent): boolean {
		return this._visibleLines.onTokensChanged(e);
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		this._context.viewModel.viewLayout.setMaxLineWidth(this._maxLineWidth);
		return this._visibleLines.onZonesChanged(e);
	}
	public override onThemeChanged(e: viewEvents.ViewThemeChangedEvent): boolean {
		return this._onOptionsMaybeChanged();
	}



	public getPositionFromDOMInfo(spanNode: HTMLElement, offset: number): Position | null {
		const viewLineDomNode = this._getViewLineDomNode(spanNode);
		if (viewLineDomNode === null) {
			return null;
		}
		const lineNumber = this._getLineNumberFor(viewLineDomNode);

		if (lineNumber === -1) {
			return null;
		}

		if (lineNumber < 1 || lineNumber > this._context.viewModel.getLineCount()) {
			return null;
		}

		if (this._context.viewModel.getLineMaxColumn(lineNumber) === 1) {
			return new Position(lineNumber, 1);
		}

		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
			return null;
		}

		let column = this._visibleLines.getVisibleLine(lineNumber).getColumnOfNodeOffset(spanNode, offset);
		const minColumn = this._context.viewModel.getLineMinColumn(lineNumber);
		if (column < minColumn) {
			column = minColumn;
		}
		return new Position(lineNumber, column);
	}

	private _getViewLineDomNode(node: HTMLElement | null): HTMLElement | null {
		while (node && node.nodeType === 1) {
			if (node.className === ViewLine.CLASS_NAME) {
				return node;
			}
			node = node.parentElement;
		}
		return null;
	}

	private _getLineNumberFor(domNode: HTMLElement): number {
		const startLineNumber = this._visibleLines.getStartLineNumber();
		const endLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const line = this._visibleLines.getVisibleLine(lineNumber);
			if (domNode === line.getDomNode()) {
				return lineNumber;
			}
		}
		return -1;
	}

	public getLineWidth(lineNumber: number): number {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
			return -1;
		}

		const context = new DomReadingContext(this.domNode.domNode, this._textRangeRestingSpot);
		const result = this._visibleLines.getVisibleLine(lineNumber).getWidth(context);
		this._updateLineWidthsSlowIfDomDidLayout(context);

		return result;
	}

	public resetLineWidthCaches(): void {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			this._visibleLines.getVisibleLine(lineNumber).resetCachedWidth();
		}
	}

	public linesVisibleRangesForRange(_range: Range, includeNewLines: boolean): LineVisibleRanges[] | null {
		const originalEndLineNumber = _range.endLineNumber;
		const range = Range.intersectRanges(_range, this._lastRenderedData.getCurrentVisibleRange());
		if (!range) {
			return null;
		}

		const visibleRanges: LineVisibleRanges[] = [];
		let visibleRangesLen = 0;
		const domReadingContext = new DomReadingContext(this.domNode.domNode, this._textRangeRestingSpot);

		let nextLineModelLineNumber: number = 0;
		if (includeNewLines) {
			nextLineModelLineNumber = this._context.viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(range.startLineNumber, 1)).lineNumber;
		}

		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = range.startLineNumber; lineNumber <= range.endLineNumber; lineNumber++) {

			if (lineNumber < rendStartLineNumber || lineNumber > rendEndLineNumber) {
				continue;
			}

			const startColumn = lineNumber === range.startLineNumber ? range.startColumn : 1;
			const continuesInNextLine = lineNumber !== originalEndLineNumber;
			const endColumn = continuesInNextLine ? this._context.viewModel.getLineMaxColumn(lineNumber) : range.endColumn;
			const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
			const visibleRangesForLine = visibleLine.getVisibleRangesForRange(lineNumber, startColumn, endColumn, domReadingContext);

			if (!visibleRangesForLine) {
				continue;
			}

			if (includeNewLines && lineNumber < originalEndLineNumber) {
				const currentLineModelLineNumber = nextLineModelLineNumber;
				nextLineModelLineNumber = this._context.viewModel.coordinatesConverter.convertViewPositionToModelPosition(new Position(lineNumber + 1, 1)).lineNumber;

				if (currentLineModelLineNumber !== nextLineModelLineNumber) {
					const floatHorizontalRange = visibleRangesForLine.ranges[visibleRangesForLine.ranges.length - 1];
					floatHorizontalRange.width += this._typicalHalfwidthCharacterWidth;
					if (this._context.viewModel.getTextDirection(currentLineModelLineNumber) === TextDirection.RTL) {
						floatHorizontalRange.left -= this._typicalHalfwidthCharacterWidth;
					}
				}
			}

			visibleRanges[visibleRangesLen++] = new LineVisibleRanges(visibleRangesForLine.outsideRenderedLine, lineNumber, HorizontalRange.from(visibleRangesForLine.ranges), continuesInNextLine);
		}

		this._updateLineWidthsSlowIfDomDidLayout(domReadingContext);

		if (visibleRangesLen === 0) {
			return null;
		}

		return visibleRanges;
	}

	private _visibleRangesForLineRange(lineNumber: number, startColumn: number, endColumn: number): VisibleRanges | null {
		if (lineNumber < this._visibleLines.getStartLineNumber() || lineNumber > this._visibleLines.getEndLineNumber()) {
			return null;
		}

		const domReadingContext = new DomReadingContext(this.domNode.domNode, this._textRangeRestingSpot);
		const result = this._visibleLines.getVisibleLine(lineNumber).getVisibleRangesForRange(lineNumber, startColumn, endColumn, domReadingContext);
		this._updateLineWidthsSlowIfDomDidLayout(domReadingContext);

		return result;
	}

	private _lineIsRenderedRTL(lineNumber: number): boolean {
		if (lineNumber < this._visibleLines.getStartLineNumber() || lineNumber > this._visibleLines.getEndLineNumber()) {
			return false;
		}
		const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
		return visibleLine.isRenderedRTL();
	}

	public visibleRangeForPosition(position: Position): HorizontalPosition | null {
		const visibleRanges = this._visibleRangesForLineRange(position.lineNumber, position.column, position.column);
		if (!visibleRanges) {
			return null;
		}
		return new HorizontalPosition(visibleRanges.outsideRenderedLine, visibleRanges.ranges[0].left);
	}


	public updateLineWidths(): void {
		this._updateLineWidths(false);
	}

	private _updateLineWidthsFast(): boolean {
		return this._updateLineWidths(true);
	}

	private _updateLineWidthsSlow(): void {
		this._updateLineWidths(false);
	}

	private _updateLineWidthsSlowIfDomDidLayout(domReadingContext: DomReadingContext): void {
		if (!domReadingContext.didDomLayout) {
			return;
		}
		if (!this._asyncUpdateLineWidths.isScheduled()) {
			return;
		}
		this._asyncUpdateLineWidths.cancel();
		this._updateLineWidthsSlow();
	}

	private _updateLineWidths(fast: boolean): boolean {
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();

		let localMaxLineWidth = 1;
		let allWidthsComputed = true;
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			const visibleLine = this._visibleLines.getVisibleLine(lineNumber);

			if (fast && !visibleLine.getWidthIsFast()) {
				allWidthsComputed = false;
				continue;
			}

			localMaxLineWidth = Math.max(localMaxLineWidth, visibleLine.getWidth(null));
		}

		if (allWidthsComputed && rendStartLineNumber === 1 && rendEndLineNumber === this._context.viewModel.getLineCount()) {
			this._maxLineWidth = 0;
		}

		this._ensureMaxLineWidth(localMaxLineWidth);

		return allWidthsComputed;
	}

	private _checkMonospaceFontAssumptions(): void {
		let longestLineNumber = -1;
		let longestWidth = -1;
		const rendStartLineNumber = this._visibleLines.getStartLineNumber();
		const rendEndLineNumber = this._visibleLines.getEndLineNumber();
		for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
			const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
			if (visibleLine.needsMonospaceFontCheck()) {
				const lineWidth = visibleLine.getWidth(null);
				if (lineWidth > longestWidth) {
					longestWidth = lineWidth;
					longestLineNumber = lineNumber;
				}
			}
		}

		if (longestLineNumber === -1) {
			return;
		}

		if (!this._visibleLines.getVisibleLine(longestLineNumber).monospaceAssumptionsAreValid()) {
			for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
				const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
				visibleLine.onMonospaceAssumptionsInvalidated();
			}
		}
	}

	public prepareRender(): void {
		throw new Error('Not supported');
	}

	public render(): void {
		throw new Error('Not supported');
	}

	public renderText(viewportData: ViewportData): void {
		this._visibleLines.renderLines(viewportData);
		this._lastRenderedData.setCurrentVisibleRange(viewportData.visibleRange);
		this.domNode.setWidth(this._context.viewLayout.getScrollWidth());
		this.domNode.setHeight(Math.min(this._context.viewLayout.getScrollHeight(), 1000000));

		if (this._horizontalRevealRequest) {

			const horizontalRevealRequest = this._horizontalRevealRequest;

			if (viewportData.startLineNumber <= horizontalRevealRequest.minLineNumber && horizontalRevealRequest.maxLineNumber <= viewportData.endLineNumber) {

				this._horizontalRevealRequest = null;

				this.onDidRender();

				const newScrollLeft = this._computeScrollLeftToReveal(horizontalRevealRequest);

				if (newScrollLeft) {
					if (!this._isViewportWrapping && !newScrollLeft.hasRTL) {
						this._ensureMaxLineWidth(newScrollLeft.maxHorizontalOffset);
					}
					this._context.viewModel.viewLayout.setScrollPosition({
						scrollLeft: newScrollLeft.scrollLeft
					}, horizontalRevealRequest.scrollType);
				}
			}
		}

		if (!this._updateLineWidthsFast()) {
			this._asyncUpdateLineWidths.schedule();
		} else {
			this._asyncUpdateLineWidths.cancel();
		}

		if (platform.isLinux && !this._asyncCheckMonospaceFontAssumptions.isScheduled()) {
			const rendStartLineNumber = this._visibleLines.getStartLineNumber();
			const rendEndLineNumber = this._visibleLines.getEndLineNumber();
			for (let lineNumber = rendStartLineNumber; lineNumber <= rendEndLineNumber; lineNumber++) {
				const visibleLine = this._visibleLines.getVisibleLine(lineNumber);
				if (visibleLine.needsMonospaceFontCheck()) {
					this._asyncCheckMonospaceFontAssumptions.schedule();
					break;
				}
			}
		}

		this._linesContent.setLayerHinting(this._canUseLayerHinting);
		this._linesContent.setContain('strict');
		const adjustedScrollTop = this._context.viewLayout.getCurrentScrollTop() - viewportData.bigNumbersDelta;
		this._linesContent.setTop(-adjustedScrollTop);
		this._linesContent.setLeft(-this._context.viewLayout.getCurrentScrollLeft());
	}


	private _ensureMaxLineWidth(lineWidth: number): void {
		if (this._viewLineOptions.useGpu) {
			return;
		}
		const iLineWidth = Math.ceil(lineWidth);
		if (this._maxLineWidth < iLineWidth) {
			this._maxLineWidth = iLineWidth;
			this._context.viewModel.viewLayout.setMaxLineWidth(this._maxLineWidth);
		}
	}

	private _computeScrollTopToRevealRange(viewport: Viewport, source: string | null | undefined, minimalReveal: boolean, range: Range | null, selections: Selection[] | null, verticalType: viewEvents.VerticalRevealType): number {
		const viewportStartY = viewport.top;
		const viewportHeight = viewport.height;
		const viewportEndY = viewportStartY + viewportHeight;
		let boxIsSingleRange: boolean;
		let boxStartY: number;
		let boxEndY: number;

		if (selections && selections.length > 0) {
			let minLineNumber = selections[0].startLineNumber;
			let maxLineNumber = selections[0].endLineNumber;
			for (let i = 1, len = selections.length; i < len; i++) {
				const selection = selections[i];
				minLineNumber = Math.min(minLineNumber, selection.startLineNumber);
				maxLineNumber = Math.max(maxLineNumber, selection.endLineNumber);
			}
			boxIsSingleRange = false;
			boxStartY = this._context.viewLayout.getVerticalOffsetForLineNumber(minLineNumber);
			boxEndY = this._context.viewLayout.getVerticalOffsetForLineNumber(maxLineNumber) + this._lineHeight;
		} else if (range) {
			boxIsSingleRange = true;
			boxStartY = this._context.viewLayout.getVerticalOffsetForLineNumber(range.startLineNumber);
			boxEndY = this._context.viewLayout.getVerticalOffsetForLineNumber(range.endLineNumber) + this._lineHeight;
		} else {
			return -1;
		}

		const shouldIgnoreScrollOff = (source === 'mouse' || minimalReveal) && this._cursorSurroundingLinesStyle === 'default';

		let paddingTop: number = 0;
		let paddingBottom: number = 0;

		if (!shouldIgnoreScrollOff) {
			const maxLinesInViewport = (viewportHeight / this._lineHeight);
			const surroundingLines = Math.max(this._cursorSurroundingLines, this._stickyScrollEnabled ? this._maxNumberStickyLines : 0);
			const context = Math.min(maxLinesInViewport / 2, surroundingLines);
			paddingTop = context * this._lineHeight;
			paddingBottom = Math.max(0, (context - 1)) * this._lineHeight;
		} else {
			if (!minimalReveal) {
				paddingTop = this._lineHeight;
			}
		}
		if (!minimalReveal) {
			if (verticalType === viewEvents.VerticalRevealType.Simple || verticalType === viewEvents.VerticalRevealType.Bottom) {
				paddingBottom += this._lineHeight;
			}
		}

		boxStartY -= paddingTop;
		boxEndY += paddingBottom;
		let newScrollTop: number;

		if (boxEndY - boxStartY > viewportHeight) {
			if (!boxIsSingleRange) {
				return -1;
			}
			newScrollTop = boxStartY;
		} else if (verticalType === viewEvents.VerticalRevealType.NearTop || verticalType === viewEvents.VerticalRevealType.NearTopIfOutsideViewport) {
			if (verticalType === viewEvents.VerticalRevealType.NearTopIfOutsideViewport && viewportStartY <= boxStartY && boxEndY <= viewportEndY) {
				newScrollTop = viewportStartY;
			} else {
				const desiredGapAbove = Math.max(5 * this._lineHeight, viewportHeight * 0.2);
				const desiredScrollTop = boxStartY - desiredGapAbove;
				const minScrollTop = boxEndY - viewportHeight;
				newScrollTop = Math.max(minScrollTop, desiredScrollTop);
			}
		} else if (verticalType === viewEvents.VerticalRevealType.Center || verticalType === viewEvents.VerticalRevealType.CenterIfOutsideViewport) {
			if (verticalType === viewEvents.VerticalRevealType.CenterIfOutsideViewport && viewportStartY <= boxStartY && boxEndY <= viewportEndY) {
				newScrollTop = viewportStartY;
			} else {
				const boxMiddleY = (boxStartY + boxEndY) / 2;
				newScrollTop = Math.max(0, boxMiddleY - viewportHeight / 2);
			}
		} else {
			newScrollTop = this._computeMinimumScrolling(viewportStartY, viewportEndY, boxStartY, boxEndY, verticalType === viewEvents.VerticalRevealType.Top, verticalType === viewEvents.VerticalRevealType.Bottom);
		}

		return newScrollTop;
	}

	private _computeScrollLeftToReveal(horizontalRevealRequest: HorizontalRevealRequest): { scrollLeft: number; maxHorizontalOffset: number; hasRTL: boolean } | null {

		const viewport = this._context.viewLayout.getCurrentViewport();
		const layoutInfo = this._context.configuration.options.get(EditorOption.layoutInfo);
		const viewportStartX = viewport.left;
		const viewportEndX = viewportStartX + viewport.width - layoutInfo.verticalScrollbarWidth;

		let boxStartX = Constants.MAX_SAFE_SMALL_INTEGER;
		let boxEndX = 0;
		let hasRTL = false;
		if (horizontalRevealRequest.type === 'range') {
			hasRTL = this._lineIsRenderedRTL(horizontalRevealRequest.lineNumber);
			const visibleRanges = this._visibleRangesForLineRange(horizontalRevealRequest.lineNumber, horizontalRevealRequest.startColumn, horizontalRevealRequest.endColumn);
			if (!visibleRanges) {
				return null;
			}
			for (const visibleRange of visibleRanges.ranges) {
				boxStartX = Math.min(boxStartX, Math.round(visibleRange.left));
				boxEndX = Math.max(boxEndX, Math.round(visibleRange.left + visibleRange.width));
			}
		} else {
			for (const selection of horizontalRevealRequest.selections) {
				if (selection.startLineNumber !== selection.endLineNumber) {
					return null;
				}
				const visibleRanges = this._visibleRangesForLineRange(selection.startLineNumber, selection.startColumn, selection.endColumn);
				hasRTL ||= this._lineIsRenderedRTL(selection.startLineNumber);
				if (!visibleRanges) {
					return null;
				}
				for (const visibleRange of visibleRanges.ranges) {
					boxStartX = Math.min(boxStartX, Math.round(visibleRange.left));
					boxEndX = Math.max(boxEndX, Math.round(visibleRange.left + visibleRange.width));
				}
			}
		}

		if (!horizontalRevealRequest.minimalReveal) {
			boxStartX = Math.max(0, boxStartX - ViewLines.HORIZONTAL_EXTRA_PX);
			boxEndX += this._revealHorizontalRightPadding;
		}

		if (horizontalRevealRequest.type === 'selections' && boxEndX - boxStartX > viewport.width) {
			return null;
		}

		const newScrollLeft = this._computeMinimumScrolling(viewportStartX, viewportEndX, boxStartX, boxEndX);
		return {
			scrollLeft: newScrollLeft,
			maxHorizontalOffset: boxEndX,
			hasRTL
		};
	}

	private _computeMinimumScrolling(viewportStart: number, viewportEnd: number, boxStart: number, boxEnd: number, revealAtStart?: boolean, revealAtEnd?: boolean): number {
		viewportStart = viewportStart | 0;
		viewportEnd = viewportEnd | 0;
		boxStart = boxStart | 0;
		boxEnd = boxEnd | 0;
		revealAtStart = !!revealAtStart;
		revealAtEnd = !!revealAtEnd;

		const viewportLength = viewportEnd - viewportStart;
		const boxLength = boxEnd - boxStart;

		if (boxLength < viewportLength) {

			if (revealAtStart) {
				return boxStart;
			}

			if (revealAtEnd) {
				return Math.max(0, boxEnd - viewportLength);
			}

			if (boxStart < viewportStart) {
				return boxStart;
			} else if (boxEnd > viewportEnd) {
				return Math.max(0, boxEnd - viewportLength);
			}
		} else {
			return boxStart;
		}

		return viewportStart;
	}
}
