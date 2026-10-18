/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardEvent } from '../../base/browser/keyboardEvent.js';
import { IMouseEvent, IMouseWheelEvent } from '../../base/browser/mouseEvent.js';
import { IBoundarySashes } from '../../base/browser/ui/sash/sash.js';
import { Event } from '../../base/common/event.js';
import { MenuId } from '../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { ConfigurationChangedEvent, EditorLayoutInfo, EditorOption, FindComputedEditorOptionValueById, IComputedEditorOptions, IDiffEditorOptions, IEditorOptions, OverviewRulerPosition } from '../common/config/editorOptions.js';
import { IDimension } from '../common/core/2d/dimension.js';
import { TextEdit } from '../common/core/edits/textEdit.js';
import { IPosition, Position } from '../common/core/position.js';
import { IRange, Range } from '../common/core/range.js';
import { Selection } from '../common/core/selection.js';
import { IWordAtPosition } from '../common/core/wordHelper.js';
import { ICursorPositionChangedEvent, ICursorSelectionChangedEvent } from '../common/cursorEvents.js';
import { IDiffComputationResult, ILineChange } from '../common/diff/legacyLinesDiffComputer.js';
import * as editorCommon from '../common/editorCommon.js';
import { GlyphMarginLane, ICursorStateComputer, IIdentifiedSingleEditOperation, IModelDecoration, IModelDecorationsChangeAccessor, IModelDeltaDecoration, ITextModel, PositionAffinity } from '../common/model.js';
import { InjectedText } from '../common/modelLineProjectionData.js';
import { TextModelEditSource } from '../common/textModelEditSource.js';
import { IModelContentChangedEvent, IModelDecorationsChangedEvent, IModelLanguageChangedEvent, IModelLanguageConfigurationChangedEvent, IModelOptionsChangedEvent, IModelTokensChangedEvent, ModelFontChangedEvent, ModelLineHeightChangedEvent } from '../common/textModelEvents.js';
import { IEditorWhitespace, IViewModel } from '../common/viewModel.js';
import { OverviewRulerZone } from '../common/viewModel/overviewZoneManager.js';
import { IEditorConstructionOptions } from './config/editorConfiguration.js';
import { IClipboardCopyEvent, IClipboardPasteEvent } from './controller/editContext/clipboardUtils.js';

export interface IViewZone {
	afterLineNumber: number;
	afterColumn?: number;
	afterColumnAffinity?: PositionAffinity;
	showInHiddenAreas?: boolean;
	ordinal?: number;
	suppressMouseDown?: boolean;
	heightInLines?: number;
	heightInPx?: number;
	minWidthInPx?: number;
	domNode: HTMLElement;
	marginDomNode?: HTMLElement | null;
	onDomNodeTop?: (top: number) => void;
	onComputedHeight?: (height: number) => void;
}
export interface IViewZoneChangeAccessor {
	addZone(zone: IViewZone): string;
	removeZone(id: string): void;
	layoutZone(id: string): void;
}

export const enum ContentWidgetPositionPreference {
	EXACT,
	ABOVE,
	BELOW
}
export interface IContentWidgetPosition {
	position: IPosition | null;
	secondaryPosition?: IPosition | null;
	preference: ContentWidgetPositionPreference[];

	positionAffinity?: PositionAffinity;
}
export interface IContentWidget {
	allowEditorOverflow?: boolean;

	useDisplayNone?: boolean;

	suppressMouseDown?: boolean;
	getId(): string;
	getDomNode(): HTMLElement;
	getPosition(): IContentWidgetPosition | null;
	beforeRender?(): IDimension | null;
	afterRender?(position: ContentWidgetPositionPreference | null, coordinate: IContentWidgetRenderedCoordinate | null): void;
}

export interface IContentWidgetRenderedCoordinate {
	readonly top: number;

	readonly left: number;
}

export const enum OverlayWidgetPositionPreference {
	TOP_RIGHT_CORNER,

	BOTTOM_RIGHT_CORNER,

	TOP_CENTER
}


export interface IOverlayWidgetPositionCoordinates {
	top: number;
	left: number;
}



export interface IOverlayWidgetPosition {
	preference: OverlayWidgetPositionPreference | IOverlayWidgetPositionCoordinates | null;

	stackOrdinal?: number;
}
export interface IOverlayWidget {
	readonly onDidLayout?: Event<void>;
	allowEditorOverflow?: boolean;
	getId(): string;
	getDomNode(): HTMLElement;
	getPosition(): IOverlayWidgetPosition | null;
	getMinContentWidthInPx?(): number;
}

export interface IGlyphMarginWidget {
	getId(): string;
	getDomNode(): HTMLElement;
	getPosition(): IGlyphMarginWidgetPosition;
}

export interface IGlyphMarginWidgetPosition {
	lane: GlyphMarginLane;
	zIndex: number;
	range: IRange;
}

export const enum MouseTargetType {
	UNKNOWN,
	TEXTAREA,
	GUTTER_GLYPH_MARGIN,
	GUTTER_LINE_NUMBERS,
	GUTTER_LINE_DECORATIONS,
	GUTTER_VIEW_ZONE,
	CONTENT_TEXT,
	CONTENT_EMPTY,
	CONTENT_VIEW_ZONE,
	CONTENT_WIDGET,
	OVERVIEW_RULER,
	SCROLLBAR,
	OVERLAY_WIDGET,
	OUTSIDE_EDITOR,
}
export interface IBaseMouseTarget {
	readonly element: HTMLElement | null;
	readonly position: Position | null;
	readonly mouseColumn: number;
	readonly range: Range | null;
}
export interface IMouseTargetUnknown extends IBaseMouseTarget {
	readonly type: MouseTargetType.UNKNOWN;
}
export interface IMouseTargetTextarea extends IBaseMouseTarget {
	readonly type: MouseTargetType.TEXTAREA;
	readonly position: null;
	readonly range: null;
}
export interface IMouseTargetMarginData {
	readonly isAfterLines: boolean;
	readonly glyphMarginLeft: number;
	readonly glyphMarginWidth: number;
	readonly glyphMarginLane?: GlyphMarginLane;
	readonly lineNumbersWidth: number;
	readonly offsetX: number;
}
export interface IMouseTargetMargin extends IBaseMouseTarget {
	readonly type: MouseTargetType.GUTTER_GLYPH_MARGIN | MouseTargetType.GUTTER_LINE_NUMBERS | MouseTargetType.GUTTER_LINE_DECORATIONS;
	readonly position: Position;
	readonly range: Range;
	readonly detail: IMouseTargetMarginData;
}
export interface IMouseTargetViewZoneData {
	readonly viewZoneId: string;
	readonly positionBefore: Position | null;
	readonly positionAfter: Position | null;
	readonly position: Position;
	readonly afterLineNumber: number;
}
export interface IMouseTargetViewZone extends IBaseMouseTarget {
	readonly type: MouseTargetType.GUTTER_VIEW_ZONE | MouseTargetType.CONTENT_VIEW_ZONE;
	readonly position: Position;
	readonly range: Range;
	readonly detail: IMouseTargetViewZoneData;
}
export interface IMouseTargetContentTextData {
	readonly mightBeForeignElement: boolean;
	/**
	 * @internal
	 */
	readonly injectedText: InjectedText | null;
}
export interface IMouseTargetContentText extends IBaseMouseTarget {
	readonly type: MouseTargetType.CONTENT_TEXT;
	readonly position: Position;
	readonly range: Range;
	readonly detail: IMouseTargetContentTextData;
}
export interface IMouseTargetContentEmptyData {
	readonly isAfterLines: boolean;
	readonly horizontalDistanceToText?: number;
}
export interface IMouseTargetContentEmpty extends IBaseMouseTarget {
	readonly type: MouseTargetType.CONTENT_EMPTY;
	readonly position: Position;
	readonly range: Range;
	readonly detail: IMouseTargetContentEmptyData;
}
export interface IMouseTargetContentWidget extends IBaseMouseTarget {
	readonly type: MouseTargetType.CONTENT_WIDGET;
	readonly position: null;
	readonly range: null;
	readonly detail: string;
}
export interface IMouseTargetOverlayWidget extends IBaseMouseTarget {
	readonly type: MouseTargetType.OVERLAY_WIDGET;
	readonly position: null;
	readonly range: null;
	readonly detail: string;
}
export interface IMouseTargetScrollbar extends IBaseMouseTarget {
	readonly type: MouseTargetType.SCROLLBAR;
	readonly position: Position;
	readonly range: Range;
}
export interface IMouseTargetOverviewRuler extends IBaseMouseTarget {
	readonly type: MouseTargetType.OVERVIEW_RULER;
}
export interface IMouseTargetOutsideEditor extends IBaseMouseTarget {
	readonly type: MouseTargetType.OUTSIDE_EDITOR;
	readonly outsidePosition: 'above' | 'below' | 'left' | 'right';
	readonly outsideDistance: number;
}
export type IMouseTarget = (
	IMouseTargetUnknown
	| IMouseTargetTextarea
	| IMouseTargetMargin
	| IMouseTargetViewZone
	| IMouseTargetContentText
	| IMouseTargetContentEmpty
	| IMouseTargetContentWidget
	| IMouseTargetOverlayWidget
	| IMouseTargetScrollbar
	| IMouseTargetOverviewRuler
	| IMouseTargetOutsideEditor
);
export interface IEditorMouseEvent {
	readonly event: IMouseEvent;
	readonly target: IMouseTarget;
}
export interface IPartialEditorMouseEvent {
	readonly event: IMouseEvent;
	readonly target: IMouseTarget | null;
}

export interface IPasteEvent {
	readonly range: Range;
	readonly languageId: string | null;
	readonly clipboardEvent?: ClipboardEvent;
}

/**
 * @internal
 */
export interface PastePayload {
	text: string;
	pasteOnNewLine: boolean;
	multicursorText: string[] | null;
	mode: string | null;
	clipboardEvent?: ClipboardEvent;
}

/**
 * An overview ruler
 * @internal
 */
export interface IOverviewRuler {
	getDomNode(): HTMLElement;
	dispose(): void;
	setZones(zones: OverviewRulerZone[]): void;
	setLayout(position: OverviewRulerPosition): void;
}

/**
 * Editor aria options.
 * @internal
 */
export interface IEditorAriaOptions {
	activeDescendant: string | undefined;
	role?: string;
}

export interface IDiffEditorConstructionOptions extends IDiffEditorOptions, IEditorConstructionOptions {
	overflowWidgetsDomNode?: HTMLElement;

	originalAriaLabel?: string;

	modifiedAriaLabel?: string;
}

export interface ICodeEditor extends editorCommon.IEditor {
	/**
	 * This editor is used as an alternative to an <input> box, i.e. as a simple widget.
	 * @internal
	 */
	readonly isSimpleWidget: boolean;
	/**
	 * The context menu ID that should be used to lookup context menu actions.
	 * @internal
	 */
	readonly contextMenuId: MenuId;
	/**
	 * The editor's scoped context key service.
	 * @internal
	 */
	readonly contextKeyService: IContextKeyService;
	readonly onDidChangeModelContent: Event<IModelContentChangedEvent>;
	readonly onDidChangeModelLanguage: Event<IModelLanguageChangedEvent>;
	readonly onDidChangeModelLanguageConfiguration: Event<IModelLanguageConfigurationChangedEvent>;
	readonly onDidChangeModelOptions: Event<IModelOptionsChangedEvent>;
	readonly onDidChangeConfiguration: Event<ConfigurationChangedEvent>;
	readonly onDidChangeCursorPosition: Event<ICursorPositionChangedEvent>;
	readonly onDidChangeCursorSelection: Event<ICursorSelectionChangedEvent>;
	readonly onWillChangeModel: Event<editorCommon.IModelChangedEvent>;
	readonly onDidChangeModel: Event<editorCommon.IModelChangedEvent>;
	readonly onDidChangeModelDecorations: Event<IModelDecorationsChangedEvent>;
	/**
	 * An event emitted when the tokens of the current model have changed.
	 * @internal
	 */
	readonly onDidChangeModelTokens: Event<IModelTokensChangedEvent>;
	readonly onDidFocusEditorText: Event<void>;
	readonly onDidBlurEditorText: Event<void>;
	readonly onDidFocusEditorWidget: Event<void>;
	readonly onDidBlurEditorWidget: Event<void>;
	/**
	 * An event emitted before interpreting typed characters (on the keyboard).
	 * @event
	 * @internal
	 */
	readonly onWillType: Event<string>;
	/**
	 * An event emitted after interpreting typed characters (on the keyboard).
	 * @event
	 * @internal
	 */
	readonly onDidType: Event<string>;
	readonly inComposition: boolean;
	readonly onDidCompositionStart: Event<void>;
	readonly onDidCompositionEnd: Event<void>;
	readonly onDidAttemptReadOnlyEdit: Event<void>;
	readonly onDidPaste: Event<IPasteEvent>;
	/**
	 * An event emitted before clipboard copy operation starts.
	 * @internal
	 * @event
	 */
	readonly onWillCopy: Event<IClipboardCopyEvent>;
	/**
	 * An event emitted before clipboard cut operation starts.
	 * @internal
	 * @event
	 */
	readonly onWillCut: Event<IClipboardCopyEvent>;
	/**
	 * An event emitted before clipboard paste operation starts.
	 * @internal
	 * @event
	 */
	readonly onWillPaste: Event<IClipboardPasteEvent>;
	readonly onMouseUp: Event<IEditorMouseEvent>;
	readonly onMouseDown: Event<IEditorMouseEvent>;
	/**
	 * An event emitted on a "mousedrag".
	 * @internal
	 * @event
	 */
	readonly onMouseDrag: Event<IEditorMouseEvent>;
	/**
	 * An event emitted on a "mousedrop".
	 * @internal
	 * @event
	 */
	readonly onMouseDrop: Event<IPartialEditorMouseEvent>;
	/**
	 * An event emitted on a "mousedropcanceled".
	 * @internal
	 * @event
	 */
	readonly onMouseDropCanceled: Event<void>;
	/**
	 * An event emitted when content is dropped into the editor.
	 * @internal
	 * @event
	 */
	readonly onDropIntoEditor: Event<{ readonly position: IPosition; readonly event: DragEvent }>;
	readonly onContextMenu: Event<IEditorMouseEvent>;
	readonly onMouseMove: Event<IEditorMouseEvent>;
	readonly onMouseLeave: Event<IPartialEditorMouseEvent>;
	/**
	 * An event emitted on a "mousewheel"
	 * @event
	 * @internal
	 */
	readonly onMouseWheel: Event<IMouseWheelEvent>;
	readonly onKeyUp: Event<IKeyboardEvent>;
	readonly onKeyDown: Event<IKeyboardEvent>;
	readonly onDidLayoutChange: Event<EditorLayoutInfo>;
	readonly onDidContentSizeChange: Event<editorCommon.IContentSizeChangedEvent>;
	readonly onDidScrollChange: Event<editorCommon.IScrollEvent>;

	readonly onDidChangeHiddenAreas: Event<void>;

	/**
	 * An event emitted before an editor
	 * @internal
	 */
	readonly onWillTriggerEditorOperationEvent: Event<editorCommon.ITriggerEditorOperationEvent>;

	readonly onBeginUpdate: Event<void>;

	readonly onEndUpdate: Event<void>;

	readonly onDidChangeViewZones: Event<void>;

	saveViewState(): editorCommon.ICodeEditorViewState | null;

	restoreViewState(state: editorCommon.ICodeEditorViewState | null): void;

	hasWidgetFocus(): boolean;

	getContribution<T extends editorCommon.IEditorContribution>(id: string): T | null;

	/**
	 * Execute `fn` with the editor's services.
	 * @internal
	 */
	invokeWithinContext<T>(fn: (accessor: ServicesAccessor) => T): T;

	getModel(): ITextModel | null;

	setModel(model: ITextModel | null): void;

	getOptions(): IComputedEditorOptions;

	getOption<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;

	getRawOptions(): IEditorOptions;

	/**
	 * @internal
	 */
	getOverflowWidgetsDomNode(): HTMLElement | undefined;

	/**
	 * @internal
	 */
	getConfiguredWordAtPosition(position: Position): IWordAtPosition | null;

	/**
	 * An event emitted when line heights from decorations change
	 * @internal
	 * @event
	 */
	readonly onDidChangeLineHeight: Event<ModelLineHeightChangedEvent>;

	/**
	 * An event emitted when the font of the editor has changed.
	 * @internal
	 * @event
	 */
	readonly onDidChangeFont: Event<ModelFontChangedEvent>;

	getValue(options?: { preserveBOM: boolean; lineEnding: string }): string;

	setValue(newValue: string): void;

	getContentWidth(): number;
	getScrollWidth(): number;
	getScrollLeft(): number;

	getContentHeight(): number;
	getScrollHeight(): number;
	getScrollTop(): number;

	setScrollLeft(newScrollLeft: number, scrollType?: editorCommon.ScrollType): void;
	setScrollTop(newScrollTop: number, scrollType?: editorCommon.ScrollType): void;
	setScrollPosition(position: editorCommon.INewScrollPosition, scrollType?: editorCommon.ScrollType): void;
	hasPendingScrollAnimation(): boolean;

	getAction(id: string): editorCommon.IEditorAction | null;

	executeCommand(source: string | null | undefined, command: editorCommon.ICommand): void;

	pushUndoStop(): boolean;

	popUndoStop(): boolean;

	executeEdits(source: string | null | undefined, edits: IIdentifiedSingleEditOperation[], endCursorState?: ICursorStateComputer | Selection[]): boolean;
	/** @internal */
	executeEdits(source: TextModelEditSource | undefined, edits: IIdentifiedSingleEditOperation[], endCursorState?: ICursorStateComputer | Selection[]): boolean;

	/**
	 * @internal
	*/
	edit(edit: TextEdit, reason: TextModelEditSource): void;

	executeCommands(source: string | null | undefined, commands: (editorCommon.ICommand | null)[]): void;

	revealAllCursors(revealHorizontal: boolean, minimalReveal?: boolean): void;

	/**
	 * @internal
	 */
	_getViewModel(): IViewModel | null;

	getLineDecorations(lineNumber: number): IModelDecoration[] | null;

	getDecorationsInRange(range: Range): IModelDecoration[] | null;

	getFontSizeAtPosition(position: IPosition): string | null;

	deltaDecorations(oldDecorations: string[], newDecorations: IModelDeltaDecoration[]): string[];

	removeDecorations(decorationIds: string[]): void;

	/**
	 * @internal
	 */
	setDecorationsByType(description: string, decorationTypeKey: string, ranges: editorCommon.IDecorationOptions[]): readonly string[];

	/**
	 * @internal
	 */
	setDecorationsByTypeFast(decorationTypeKey: string, ranges: IRange[]): void;

	/**
	 * @internal
	 */
	removeDecorationsByType(decorationTypeKey: string): void;

	getLayoutInfo(): EditorLayoutInfo;

	getVisibleRanges(): Range[];

	/**
	 * @internal
	 */
	getVisibleRangesPlusViewportAboveBelow(): Range[];

	/**
	 * Get the view zones.
	 * @internal
	 */
	getWhitespaces(): IEditorWhitespace[];

	getTopForLineNumber(lineNumber: number, includeViewZones?: boolean): number;

	getBottomForLineNumber(lineNumber: number): number;

	getTopForPosition(lineNumber: number, column: number): number;

	getLineHeightForPosition(position: IPosition): number;

	/**
	 * Set the model ranges that will be hidden in the view.
	 * Hidden areas are stored per source.
	 * @internal
	 */
	setHiddenAreas(ranges: IRange[], source?: unknown): void;

	/**
	 * Sets the editor aria options, primarily the active descendent.
	 * @internal
	 */
	setAriaOptions(options: IEditorAriaOptions): void;

	writeScreenReaderContent(reason: string): void;

	/**
	 * @internal
	 */
	getTelemetryData(): object | undefined;

	getContainerDomNode(): HTMLElement;

	getDomNode(): HTMLElement | null;

	addContentWidget(widget: IContentWidget): void;
	layoutContentWidget(widget: IContentWidget): void;
	removeContentWidget(widget: IContentWidget): void;

	addOverlayWidget(widget: IOverlayWidget): void;
	layoutOverlayWidget(widget: IOverlayWidget): void;
	removeOverlayWidget(widget: IOverlayWidget): void;

	addGlyphMarginWidget(widget: IGlyphMarginWidget): void;
	layoutGlyphMarginWidget(widget: IGlyphMarginWidget): void;
	removeGlyphMarginWidget(widget: IGlyphMarginWidget): void;

	changeViewZones(callback: (accessor: IViewZoneChangeAccessor) => void): void;

	getOffsetForColumn(lineNumber: number, column: number): number;

	getWidthOfLine(lineNumber: number): number;

	/**
	 * Reset cached line widths. Call this when the editor becomes visible after being hidden.
	 * @internal
	 */
	resetLineWidthCaches(): void;

	render(forceRedraw?: boolean): void;

	renderAsync(forceRedraw?: boolean): void;

	getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null;

	getScrolledVisiblePosition(position: IPosition): { top: number; left: number; height: number } | null;

	applyFontInfo(target: HTMLElement): void;

	/**
	 * Check if the current instance has a model attached.
	 * @internal
	 */
	hasModel(): this is IActiveCodeEditor;

	setBanner(bannerDomNode: HTMLElement | null, height: number): void;

	handleInitialized?(): void;
}

/**
 * @internal
 */
export interface IActiveCodeEditor extends ICodeEditor {
	getPosition(): Position;

	getSelection(): Selection;

	getSelections(): Selection[];

	saveViewState(): editorCommon.ICodeEditorViewState;

	getModel(): ITextModel;

	/**
	 * @internal
	 */
	_getViewModel(): IViewModel;

	getLineDecorations(lineNumber: number): IModelDecoration[];

	getDomNode(): HTMLElement;

	getScrolledVisiblePosition(position: IPosition): { top: number; left: number; height: number };

	/**
	 * Change the decorations. All decorations added through this changeAccessor
	 * will get the ownerId of the editor (meaning they will not show up in other
	 * editors).
	 * @see {@link ITextModel.changeDecorations}
	 * @internal
	 */
	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T;
}

/**
 * @internal
 */
export const enum DiffEditorState {
	Idle,
	ComputingDiff,
	DiffComputed
}

export interface IDiffEditor extends editorCommon.IEditor {

	/**
	 * Returns whether the diff editor is ignoring trim whitespace or not.
	 * @internal
	 */
	readonly ignoreTrimWhitespace: boolean;
	/**
	 * Returns whether the diff editor is rendering side by side or inline.
	 * @internal
	 */
	readonly renderSideBySide: boolean;
	/**
	 * Timeout in milliseconds after which diff computation is cancelled.
	 * @internal
	 */
	readonly maxComputationTime: number;

	getContainerDomNode(): HTMLElement;

	readonly onDidUpdateDiff: Event<void>;

	readonly onDidChangeModel: Event<void>;

	saveViewState(): editorCommon.IDiffEditorViewState | null;

	restoreViewState(state: editorCommon.IDiffEditorViewState | null): void;

	getModel(): editorCommon.IDiffEditorModel | null;

	createViewModel(model: editorCommon.IDiffEditorModel): editorCommon.IDiffEditorViewModel;

	setModel(model: editorCommon.IDiffEditorModel | editorCommon.IDiffEditorViewModel | null): void;

	getOriginalEditor(): ICodeEditor;

	getModifiedEditor(): ICodeEditor;

	getLineChanges(): ILineChange[] | null;

	/**
	 * Get the computed diff information.
	 * @internal
	 */
	getDiffComputationResult(): IDiffComputationResult | null;

	updateOptions(newOptions: IDiffEditorOptions): void;

	/**
	 * @internal
	 */
	setBoundarySashes(sashes: IBoundarySashes): void;

	goToDiff(target: 'next' | 'previous'): void;

	revealFirstDiff(): unknown;

	accessibleDiffViewerNext(): void;

	accessibleDiffViewerPrev(): void;

	handleInitialized(): void;
}

/**
 *@internal
 */
export function isCodeEditor(thing: unknown): thing is ICodeEditor {
	if (thing && typeof (<ICodeEditor>thing).getEditorType === 'function') {
		return (<ICodeEditor>thing).getEditorType() === editorCommon.EditorType.ICodeEditor;
	} else {
		return false;
	}
}

/**
 *@internal
 */
export function isDiffEditor(thing: unknown): thing is IDiffEditor {
	if (thing && typeof (<IDiffEditor>thing).getEditorType === 'function') {
		return (<IDiffEditor>thing).getEditorType() === editorCommon.EditorType.IDiffEditor;
	} else {
		return false;
	}
}

/**
 *@internal
 */
export function isCompositeEditor(thing: unknown): thing is editorCommon.ICompositeCodeEditor {
	return !!thing
		&& typeof thing === 'object'
		&& typeof (<editorCommon.ICompositeCodeEditor>thing).onDidChangeActiveEditor === 'function';

}

/**
 *@internal
 */
export function getCodeEditor(thing: unknown): ICodeEditor | null {
	if (isCodeEditor(thing)) {
		return thing;
	}

	if (isDiffEditor(thing)) {
		return thing.getModifiedEditor();
	}

	if (isCompositeEditor(thing) && isCodeEditor(thing.activeCodeEditor)) {
		return thing.activeCodeEditor;
	}

	return null;
}

/**
 *@internal
 */
export function getIEditor(thing: unknown): editorCommon.IEditor | null {
	if (isCodeEditor(thing) || isDiffEditor(thing)) {
		return thing;
	}

	return null;
}

/**
 *@internal
 */
export function isIOverlayWidgetPositionCoordinates(thing: unknown): thing is IOverlayWidgetPositionCoordinates {
	return !!thing
		&& typeof thing === 'object'
		&& typeof (<IOverlayWidgetPositionCoordinates>thing).top === 'number'
		&& typeof (<IOverlayWidgetPositionCoordinates>thing).left === 'number';
}
