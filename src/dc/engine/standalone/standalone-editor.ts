/**
 * Dardcor Code - Standalone Embeddable Editor Instance (Task 230)
 * Mirrors: vs/editor/standalone/browser/standaloneCodeEditor.ts
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { ITextModel, Position, Range, TextModel } from '../model/text-model.js';
import { LineToken, LineTokens } from '../model/line-tokens.js';
import { EditStack } from '../model/edit-stack.js';
import { ViewModel } from '../view/view-model.js';
import { ViewLayout } from '../view/view-layout.js';
import { Viewport } from '../view/viewport.js';
import { EditorOptions, IRenderContext, IEditorOptions } from '../options/editor-options.js';
import { MultiCursor } from '../cursor/multi-cursor.js';
import { CursorController, CursorMoveCommand, IEditOperationInput } from '../cursor/cursor-controller.js';
import { CursorSelection } from '../cursor/cursor-operations.js';
import { LineRenderer } from '../view/renderers/line-renderer.js';
import { GutterRenderer } from '../view/renderers/gutter-renderer.js';
import { DecorationRenderer } from '../view/renderers/decoration-renderer.js';
import { CursorRenderer } from '../view/renderers/cursor-renderer.js';
import { SelectionRenderer } from '../view/renderers/selection-renderer.js';
import { WhitespaceRenderer } from '../view/renderers/whitespace-renderer.js';
import { IndentGuideRenderer } from '../view/renderers/indent-guide-renderer.js';
import { KeyboardInput } from '../controller/keyboard-input.js';
import { MouseInput } from '../controller/mouse-input.js';
import { ScrollController } from '../controller/scroll-controller.js';
import { TextMateTokenizer } from '../tokenizer/textmate-tokenizer.js';
import { DecorationRangeMap, IDecorationInterval } from '../model/range-map.js';

export interface IStandaloneEditorOptions {
	readonly value?: string;
	readonly language?: string;
	readonly theme?: 'vs-dark' | 'vs' | 'hc-black';
	readonly fontSize?: number;
	readonly lineHeight?: number;
	readonly tabSize?: number;
	readonly insertSpaces?: boolean;
	readonly readOnly?: boolean;
	readonly lineNumbers?: 'on' | 'off' | 'relative';
	readonly renderWhitespace?: 'none' | 'boundary' | 'all';
	readonly renderIndentGuides?: boolean;
}

const BASE_CSS = `
.dc-editor{position:relative;display:flex;flex-direction:row;width:100%;height:100%;background:#1e1e1e;color:#d4d4d4;font-family:Consolas,'Courier New',monospace;font-size:14px;overflow:hidden;user-select:none;}
.dc-editor-gutter-wrap{position:relative;flex:0 0 auto;overflow:hidden;background:#1e1e1e;border-right:1px solid #333;}
.dc-gutter{position:relative;}
.dc-glyph-margin{position:absolute;top:0;left:0;width:24px;}
.dc-line-numbers{position:absolute;top:0;left:24px;color:#858585;}
.dc-line-number-active{color:#c6c6c6;background:#282828;}
.dc-editor-scroll{flex:1 1 auto;overflow:auto;position:relative;}
.dc-editor-content{position:relative;}
.dc-view-lines{position:absolute;top:0;left:0;right:0;}
.dc-view-line{color:#d4d4d4;}
.dc-selection{background:rgba(38,79,120,0.6);}
.dc-cursor{background:#aeafad;z-index:10;}
.dc-cursor-unfocused{opacity:0.5;}
.dc-cursor-hidden{opacity:0;}
.dc-whitespace-glyph{color:#6b6b6b;}
.dc-indent-guide{background:#404040;}
.dc-decoration{background:rgba(255,255,0,0.1);}
.dc-editor-textarea{position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;overflow:hidden;resize:none;border:none;padding:0;margin:0;white-space:pre;caret-color:transparent;outline:none;}
.dc-token-comment{color:#6a9955;}
.dc-token-string{color:#ce9178;}
.dc-token-keyword{color:#569cd6;}
.dc-token-type{color:#4ec9b0;}
.dc-token-number{color:#b5cea8;}
.dc-token-annotation{color:#d7ba7d;}
.dc-token-constant{color:#b5cea8;}
.dc-token-variable{color:#9cdcfe;}
.dc-token-property{color:#9cdcfe;}
.dc-token-selector{color:#d7ba7d;}
.dc-token-tag{color:#569cd6;}
.dc-token-attribute{color:#9cdcfe;}
.dc-token-operator{color:#d4d4d4;}
.dc-token-delimiter{color:#d4d4d4;}
.dc-token-whitespace{color:#d4d4d4;}
.dc-token-text{color:#d4d4d4;}
.dc-token-identifier{color:#d4d4d4;}
`;

let cssInjected = false;

export class StandaloneEditor extends Disposable {
	private readonly _options: EditorOptions;
	private _model: TextModel;
	private _viewModel: ViewModel;
	private readonly _layout: ViewLayout;
	private readonly _editStack: EditStack;
	private readonly _multiCursor: MultiCursor;
	private readonly _cursorController: CursorController;
	private readonly _tokenizer: TextMateTokenizer;
	private readonly _decorationMap: DecorationRangeMap;
	private readonly _tokenCache = new Map<number, LineToken[]>();
	private readonly _tokenStates = new Map<number, unknown>();
	private _maxLineLength = 0;
	private _focused = false;
	private _renderFrame = 0;

	private readonly _root: HTMLElement;
	private readonly _gutterWrap: HTMLElement;
	private readonly _scrollContainer: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _textarea: HTMLTextAreaElement;

	private readonly _lineRenderer: LineRenderer;
	private readonly _gutterRenderer: GutterRenderer;
	private readonly _decorationRenderer: DecorationRenderer;
	private readonly _cursorRenderer: CursorRenderer;
	private readonly _selectionRenderer: SelectionRenderer;
	private readonly _whitespaceRenderer: WhitespaceRenderer;
	private readonly _indentGuideRenderer: IndentGuideRenderer;
	private readonly _keyboardInput: KeyboardInput;
	private readonly _mouseInput: MouseInput;
	private readonly _scrollController: ScrollController;

	private readonly _onDidChangeModelContent = this._register(new Emitter<void>());
	readonly onDidChangeModelContent: Event<void> = this._onDidChangeModelContent.event;

	private readonly _onDidChangeCursorPosition = this._register(new Emitter<Position>());
	readonly onDidChangeCursorPosition: Event<Position> = this._onDidChangeCursorPosition.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	readonly onDidChangeSelection: Event<void> = this._onDidChangeSelection.event;

	constructor(container: HTMLElement, options: IStandaloneEditorOptions = {}) {
		super();
		this._options = new EditorOptions({
			tabSize: options.tabSize,
			insertSpaces: options.insertSpaces,
			fontSize: options.fontSize,
			lineHeight: options.lineHeight,
			readOnly: options.readOnly,
			lineNumbers: options.lineNumbers,
			renderWhitespace: options.renderWhitespace,
			renderIndentGuides: options.renderIndentGuides,
		});

		this._model = new TextModel(URI.from({ scheme: 'untitled', path: 'editor' }), options.value ?? '');
		this._viewModel = new ViewModel(this._model);
		this._layout = new ViewLayout({
			lineCount: this._viewModel.getLineCount(),
			lineHeight: this._options.getOption('lineHeight'),
			scrollWidth: 800,
		});
		this._editStack = new EditStack();
		this._multiCursor = new MultiCursor();
		this._cursorController = new CursorController(this._model, this._multiCursor, this._editStack, this._layout, this._options);
		this._tokenizer = new TextMateTokenizer(options.language ?? 'plaintext');
		this._decorationMap = new DecorationRangeMap();

		this._root = $<HTMLElement>('div', 'dc-editor');
		this._gutterWrap = $<HTMLElement>('div', 'dc-editor-gutter-wrap');
		this._scrollContainer = $<HTMLElement>('div', 'dc-editor-scroll');
		this._content = $<HTMLElement>('div', 'dc-editor-content');
		this._textarea = $<HTMLTextAreaElement>('textarea', 'dc-editor-textarea');
		this._textarea.spellcheck = false;
		this._textarea.autocapitalize = 'off';
		this._textarea.autocomplete = 'off';

		this._lineRenderer = new LineRenderer();
		this._gutterRenderer = new GutterRenderer();
		this._decorationRenderer = new DecorationRenderer(this._decorationMap);
		this._cursorRenderer = new CursorRenderer();
		this._selectionRenderer = new SelectionRenderer();
		this._whitespaceRenderer = new WhitespaceRenderer();
		this._indentGuideRenderer = new IndentGuideRenderer();
		this._keyboardInput = new KeyboardInput(this._textarea);
		this._mouseInput = new MouseInput(this._content, this._layout, this._options,
			() => this._viewModel.getLineCount(),
			lineNumber => this._viewModel.getLineContent(lineNumber).length
		);
		this._scrollController = new ScrollController(this._scrollContainer, this._layout, this._options,
			() => this._scrollContainer.clientHeight
		);

		this._content.appendChild(this._lineRenderer.getDomNode());
		this._content.appendChild(this._decorationRenderer.getDomNode());
		this._content.appendChild(this._selectionRenderer.getDomNode());
		this._content.appendChild(this._whitespaceRenderer.getDomNode());
		this._content.appendChild(this._indentGuideRenderer.getDomNode());
		this._content.appendChild(this._cursorRenderer.getDomNode());
		this._scrollContainer.appendChild(this._content);
		this._gutterWrap.appendChild(this._gutterRenderer.getDomNode());
		this._root.appendChild(this._gutterWrap);
		this._root.appendChild(this._scrollContainer);
		this._root.appendChild(this._textarea);
		container.appendChild(this._root);

		if (!cssInjected) {
			const style = $<HTMLStyleElement>('style');
			style.textContent = BASE_CSS;
			document.head.appendChild(style);
			cssInjected = true;
		}

		this._registerListeners();
		this._invalidateTokens();
		this._render();
	}

	getValue(): string {
		return this._model.getValue();
	}

	setValue(value: string): void {
		this._model.setValue(value);
	}

	getModel(): ITextModel {
		return this._model;
	}

	getLineCount(): number {
		return this._model.getLineCount();
	}

	getLineContent(lineNumber: number): string {
		return this._model.getLineContent(lineNumber);
	}

	getPosition(): Position {
		return this._cursorController.getPosition();
	}

	setPosition(position: Position, inSelectionMode = false): void {
		this._cursorController.setPosition(position, inSelectionMode);
	}

	getSelections(): CursorSelection[] {
		return this._cursorController.getSelections();
	}

	setSelections(selections: CursorSelection[]): void {
		this._cursorController.setSelections(selections);
	}

	getOptions(): IEditorOptions {
		return this._options.options;
	}

	setOptions(options: Partial<IEditorOptions>): void {
		this._options.updateOptions(options);
	}

	undo(): void {
		this._cursorController.undo();
	}

	redo(): void {
		this._cursorController.redo();
	}

	executeEdits(edits: IEditOperationInput[]): void {
		this._cursorController.applyEdits(edits);
	}

	addDecoration(range: Range, className: string): string {
		const id = 'dec-' + Math.random().toString(36).slice(2, 10);
		this._decorationMap.add(id, range, { className });
		this._render();
		return id;
	}

	removeDecoration(id: string): void {
		this._decorationMap.remove(id);
		this._render();
	}

	getDecorationsInRange(range: Range): IDecorationInterval[] {
		return this._decorationMap.getDecorationsInRange(range);
	}

	focus(): void {
		this._textarea.focus();
	}

	layout(): void {
		this._updateContentSize();
		this._render();
	}

	private _registerListeners(): void {
		this._register(this._viewModel.onDidChangeViewLineCount(() => this._handleModelChanged()));
		this._register(this._model.onDidChangeContent(() => this._onDidChangeModelContent.fire()));

		this._register(this._cursorController.onDidChangeCursorPosition(e => {
			this._onDidChangeCursorPosition.fire(e.position);
			this._syncTextarea();
			this._revealCursor(e.position);
			this._scheduleRender();
		}));
		this._register(this._cursorController.onDidChangeSelection(() => {
			this._onDidChangeSelection.fire();
			this._syncTextarea();
			this._scheduleRender();
		}));
		this._register(this._multiCursor.onDidChange(() => this._scheduleRender()));
		this._register(this._options.onDidChangeOptions(() => this._scheduleRender()));

		this._register(addDisposableListener(this._scrollContainer, 'scroll', () => {
			this._gutterWrap.scrollTop = this._scrollContainer.scrollTop;
			this._scheduleRender();
		}));
		this._register(addDisposableListener(this._root, 'mousedown', () => this.focus()));
		this._register(addDisposableListener(this._textarea, 'focus', () => {
			this._focused = true;
			this._cursorRenderer.setFocused(true);
			this._render();
		}));
		this._register(addDisposableListener(this._textarea, 'blur', () => {
			this._focused = false;
			this._cursorRenderer.setFocused(false);
			this._render();
		}));

		this._register(this._keyboardInput.onKeyDown(e => this._handleKeyDown(e)));
		this._register(this._keyboardInput.onTextInput(delta => this._handleTextInput(delta.text, delta.startOffset, delta.endOffset)));
		this._register(this._keyboardInput.onPaste(text => this._typeText(text)));
		this._register(this._keyboardInput.onCut(() => this._cut()));

		this._register(this._mouseInput.onMouseDown(data => {
			if (data.altKey) {
				this._multiCursor.addCursorAt(data.position);
				this._cursorController.setPosition(data.position, false);
				return;
			}
			if (data.shiftKey) {
				const primary = this._cursorController.getPrimarySelection();
				this._cursorController.setSelection(primary.anchor, data.position);
			} else {
				this._cursorController.setPosition(data.position, false);
			}
			if (data.clickCount >= 3) {
				this._cursorController.selectLine();
			} else if (data.clickCount === 2) {
				this._cursorController.selectWord();
			}
		}));
		this._register(this._mouseInput.onMouseDrag(data => {
			this._cursorController.setSelection(data.start, data.current);
		}));
	}

	private _handleModelChanged(): void {
		this._invalidateTokens();
		this._layout.updateLineCount(this._viewModel.getLineCount());
		this._multiCursor.clampToModel(this._model);
		this._recomputeMaxLineLength();
		this._updateContentSize();
		this._scheduleRender();
	}

	private _invalidateTokens(): void {
		this._tokenCache.clear();
		this._tokenStates.clear();
	}

	private _recomputeMaxLineLength(): void {
		let max = 0;
		const count = this._model.getLineCount();
		for (let i = 1; i <= count; i++) {
			max = Math.max(max, this._model.getLineContent(i).length);
		}
		this._maxLineLength = max;
	}

	private _ensureTokens(upTo: number): void {
		let state: any = this._tokenizer.getInitialState();
		const count = this._viewModel.getLineCount();
		for (let i = 1; i <= Math.min(upTo, count); i++) {
			const modelLine = this._viewModel.viewPositionToModelPosition(new Position(i, 1)).lineNumber;
			const cached = this._tokenCache.get(modelLine);
			if (cached) {
				state = this._tokenStates.get(modelLine) ?? state;
				continue;
			}
			const result = this._tokenizer.tokenizeLine(this._model.getLineContent(modelLine), state as any);
			this._tokenCache.set(modelLine, result.tokens);

			this._tokenStates.set(modelLine, result.state);
			state = result.state;
		}
	}


	private _getLineTokens(viewLineNumber: number): LineTokens | null {
		const modelLine = this._viewModel.viewPositionToModelPosition(new Position(viewLineNumber, 1)).lineNumber;
		const tokens = this._tokenCache.get(modelLine);
		if (!tokens) {
			return null;
		}
		return new LineTokens(tokens, this._model.getLineContent(modelLine).length);
	}

	private _render(): void {
		const viewport = Viewport.compute(
			this._layout.getScrollTop(),
			Math.max(1, this._scrollContainer.clientHeight),
			this._options.getOption('lineHeight'),
			this._viewModel.getLineCount()
		);
		this._ensureTokens(viewport.endLineNumber);
		this._cursorRenderer.setCursors(this._multiCursor.getActivePositions());
		this._selectionRenderer.setSelections(this._multiCursor.getSelections());
		this._updateContentSize();

		const ctx: IRenderContext = {
			layout: this._layout,
			viewport: {
				...viewport,
				top: this._layout.getVerticalOffsetForLineNumber(viewport.startLineNumber),
				height: this._options.getOption('lineHeight') * viewport.visibleLineCount,
			},
			options: this._options.options,
			model: this._model,
			lineHeight: this._options.getOption('lineHeight'),
			charWidth: this._charWidth(),
			cursors: this._multiCursor.getSelections(),
			viewModel: this._viewModel,
			getLineTokens: viewLine => this._getLineTokens(viewLine),
		};

		this._gutterRenderer.render(ctx);
		this._lineRenderer.render(ctx);
		this._decorationRenderer.render(ctx);
		this._selectionRenderer.render(ctx);
		this._whitespaceRenderer.render(ctx);
		this._indentGuideRenderer.render(ctx);
		this._cursorRenderer.render(ctx);
	}

	private _scheduleRender(): void {
		if (this._renderFrame) {
			return;
		}
		this._renderFrame = window.requestAnimationFrame(() => {
			this._renderFrame = 0;
			this._render();
		});
	}

	private _updateContentSize(): void {
		const lineHeight = this._options.getOption('lineHeight');
		const charWidth = this._charWidth();
		const height = this._viewModel.getLineCount() * lineHeight;
		const width = Math.max(this._scrollContainer.clientWidth, this._maxLineLength * charWidth + 16);
		this._content.style.height = `${height}px`;
		this._content.style.width = `${width}px`;
	}

	private _syncTextarea(): void {
		if (this._keyboardInput.isComposing()) {
			return;
		}
		const value = this._model.getValue();
		const primary = this._cursorController.getPrimarySelection();
		const startOffset = this._positionToOffset(primary.start);
		const endOffset = this._positionToOffset(primary.end);
		this._keyboardInput.setValue(value, startOffset, endOffset);
	}

	private _positionToOffset(position: Position): number {
		let offset = 0;
		for (let line = 1; line < position.lineNumber; line++) {
			offset += this._model.getLineContent(line).length + 1;
		}
		return offset + (position.column - 1);
	}

	private _offsetToPosition(offset: number): Position {
		const value = this._model.getValue();
		if (offset <= 0) {
			return new Position(1, 1);
		}
		let pos = 0;
		for (let line = 1; line <= this._model.getLineCount(); line++) {
			const len = this._model.getLineContent(line).length + 1;
			if (pos + len > offset) {
				return new Position(line, Math.min(offset - pos + 1, len));
			}
			pos += len;
		}
		return new Position(this._model.getLineCount(), value.length - pos + 1);
	}

	private _handleTextInput(text: string, startOffset: number, endOffset: number): void {
		if (this._options.getOption('readOnly')) {
			return;
		}
		const start = this._offsetToPosition(startOffset);
		const end = this._offsetToPosition(endOffset);
		this._cursorController.applyEdits([{ range: new Range(start.lineNumber, start.column, end.lineNumber, end.column), text }], 'input');
		this._syncTextarea();
	}

	private _typeText(text: string): void {
		if (this._options.getOption('readOnly')) {
			return;
		}
		this._cursorController.typeText(text);
		this._syncTextarea();
	}

	private _handleKeyDown(e: KeyboardEvent): void {
		const ctrl = e.ctrlKey || e.metaKey;
		const shift = e.shiftKey;
		const alt = e.altKey;
		const readOnly = this._options.getOption('readOnly');
		const composing = e.isComposing || e.keyCode === 229;
		const key = e.key;

		if (ctrl && !alt && !shift && (key === 'c' || key === 'C')) {
			e.preventDefault();
			this._copy();
			return;
		}
		if (ctrl && !alt && shift && (key === 'x' || key === 'X')) {
			e.preventDefault();
			this._cut();
			return;
		}
		if (ctrl && !alt && (key === 'a' || key === 'A')) {
			e.preventDefault();
			this._cursorController.selectAll();
			return;
		}
		if (ctrl && !alt && (key === 'z' || key === 'Z')) {
			e.preventDefault();
			if (shift) {
				this._cursorController.redo();
			} else {
				this._cursorController.undo();
			}
			return;
		}
		if (ctrl && !alt && (key === 'y' || key === 'Y')) {
			e.preventDefault();
			this._cursorController.redo();
			return;
		}
		if (ctrl && alt && (key === 'ArrowDown' || key === 'ArrowUp')) {
			e.preventDefault();
			const position = this._cursorController.getPosition();
			const next = key === 'ArrowDown'
				? new Position(Math.min(position.lineNumber + 1, this._model.getLineCount()), position.column)
				: new Position(Math.max(1, position.lineNumber - 1), position.column);
			this._multiCursor.addCursorAt(next);
			this._cursorController.setPosition(next, false);
			return;
		}

		if (composing) {
			return;
		}

		switch (key) {
			case 'ArrowLeft':
				e.preventDefault();
				this._cursorController.move(ctrl ? CursorMoveCommand.WordLeft : CursorMoveCommand.Left, shift);
				return;
			case 'ArrowRight':
				e.preventDefault();
				this._cursorController.move(ctrl ? CursorMoveCommand.WordRight : CursorMoveCommand.Right, shift);
				return;
			case 'ArrowUp':
				e.preventDefault();
				this._cursorController.move(CursorMoveCommand.Up, shift);
				return;
			case 'ArrowDown':
				e.preventDefault();
				this._cursorController.move(CursorMoveCommand.Down, shift);
				return;
			case 'Home':
				e.preventDefault();
				this._cursorController.move(ctrl ? CursorMoveCommand.Top : CursorMoveCommand.LineStart, shift);
				return;
			case 'End':
				e.preventDefault();
				this._cursorController.move(ctrl ? CursorMoveCommand.Bottom : CursorMoveCommand.LineEnd, shift);
				return;
			case 'PageUp':
				e.preventDefault();
				this._cursorController.move(CursorMoveCommand.PageUp, shift);
				return;
			case 'PageDown':
				e.preventDefault();
				this._cursorController.move(CursorMoveCommand.PageDown, shift);
				return;
			case 'Escape':
				e.preventDefault();
				this._cursorController.clearSelection();
				this._multiCursor.removeAllButPrimary();
				return;
		}

		if (readOnly) {
			return;
		}

		switch (key) {
			case 'Enter':
				e.preventDefault();
				this._typeText('\n' + this._getAutoIndent());
				return;
			case 'Tab':
				e.preventDefault();
				this._cursorController.typeTab();
				this._syncTextarea();
				return;
			case 'Backspace':
				e.preventDefault();
				if (ctrl) {
					this._cursorController.deleteWord('left');
				} else {
					this._cursorController.backspace();
				}
				return;
			case 'Delete':
				e.preventDefault();
				if (ctrl) {
					this._cursorController.deleteWord('right');
				} else {
					this._cursorController.delete();
				}
				return;
		}

		if (!ctrl && !alt && key.length === 1) {
			e.preventDefault();
			this._typeText(key);
		}
	}

	private _getAutoIndent(): string {
		const primary = this._cursorController.getPrimarySelection();
		const content = this._model.getLineContent(primary.active.lineNumber);
		const match = /^\s*/.exec(content);
		return match ? match[0] : '';
	}

	private _copy(): void {
		const selection = this._cursorController.getPrimarySelection();
		if (!selection.isSelection) {
			return;
		}
		const text = this._cursorController.getTextInRange(new Range(
			selection.start.lineNumber, selection.start.column,
			selection.end.lineNumber, selection.end.column
		));
		this._writeClipboard(text);
	}

	private _cut(): void {
		if (this._options.getOption('readOnly')) {
			return;
		}
		const selection = this._cursorController.getPrimarySelection();
		if (!selection.isSelection) {
			return;
		}
		const text = this._cursorController.getTextInRange(new Range(
			selection.start.lineNumber, selection.start.column,
			selection.end.lineNumber, selection.end.column
		));
		this._writeClipboard(text);
		this._cursorController.applyEdits([{
			range: new Range(selection.start.lineNumber, selection.start.column, selection.end.lineNumber, selection.end.column),
			text: '',
		}], 'cut');
	}

	private _writeClipboard(text: string): void {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).catch(() => this._fallbackWriteClipboard(text));
		} else {
			this._fallbackWriteClipboard(text);
		}
	}

	private _fallbackWriteClipboard(text: string): void {
		const helper = $<HTMLTextAreaElement>('textarea');
		helper.value = text;
		helper.style.cssText = 'position:fixed;opacity:0;';
		document.body.appendChild(helper);
		helper.select();
		try {
			document.execCommand('copy');
		} catch {
			// clipboard unavailable
		}
		document.body.removeChild(helper);
	}

	private _revealCursor(position: Position): void {
		const lineHeight = this._options.getOption('lineHeight');
		const charWidth = this._charWidth();
		const top = this._layout.getVerticalOffsetForLineNumber(position.lineNumber);
		this._scrollController.ensureVisible(top, top + lineHeight);
		const x = (position.column - 1) * charWidth;
		const left = this._layout.getScrollLeft();
		const width = this._scrollContainer.clientWidth;
		if (x < left) {
			this._layout.setScrollPosition(this._layout.getScrollTop(), x);
		} else if (x > left + width - charWidth * 2) {
			this._layout.setScrollPosition(this._layout.getScrollTop(), x - width + charWidth * 2);
		}
	}

	private _charWidth(): number {
		return Math.round(this._options.getOption('fontSize') * 0.6 * 10) / 10;
	}

	override dispose(): void {
		if (this._renderFrame) {
			cancelAnimationFrame(this._renderFrame);
			this._renderFrame = 0;
		}
		this._root.remove();
		super.dispose();
	}
}

export function createStandaloneEditor(container: HTMLElement, options?: IStandaloneEditorOptions): StandaloneEditor {
	return new StandaloneEditor(container, options);
}
