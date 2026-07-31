import { Disposable } from '../../core/lifecycle/disposable.js';
import { $, clearNode, addDisposableListener } from '../../core/dom/element.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { TextModel, Position, IModelContentChangedEvent } from '../model/text-model.js';
import { GrammarRegistry, IGrammar } from '../tokenizer/grammar-registry.js';
import { expandTabs } from '../view/view-line-rendering.js';

export interface IStandaloneCodeEditorOptions {
	readonly value?: string;
	readonly language?: string;
	readonly readOnly?: boolean;
	readonly lineNumbers?: boolean;
	readonly fontSize?: number;
	readonly lineHeight?: number;
	readonly tabSize?: number;
}

export interface ICodeEditorCursorPosition {
	readonly lineNumber: number;
	readonly column: number;
}

const TOKEN_CLASS_MAP: Readonly<Record<string, string>> = {
	'comment.line': 'dc-token-comment',
	'comment.block': 'dc-token-comment',
	'comment.block.documentation': 'dc-token-comment',
	'string.quoted': 'dc-token-string',
	'constant.numeric': 'dc-token-number',
	'constant.language': 'dc-token-constant',
	'constant.other.color': 'dc-token-constant',
	'keyword': 'dc-token-keyword',
	'storage.type': 'dc-token-type',
	'support.type.property-name': 'dc-token-property',
	'entity.name.function': 'dc-token-variable',
	'entity.name.tag': 'dc-token-tag',
	'entity.name.tag.class': 'dc-token-tag',
	'entity.other.attribute-name': 'dc-token-attribute',
	'markup.heading': 'dc-token-tag',
	'markup.list': 'dc-token-variable',
	'markup.inline.raw': 'dc-token-string',
	'markup.fenced_code.block': 'dc-token-string',
	'markup.underline.link': 'dc-token-annotation',
	'markup.bold': 'dc-token-keyword',
};

function scopeToClass(scope: string): string {
	return TOKEN_CLASS_MAP[scope] ?? 'dc-token-text';
}

export class StandaloneCodeEditor extends Disposable {
	private readonly _model: TextModel;
	private readonly _grammarRegistry = new GrammarRegistry();
	private _grammar: IGrammar;
	private readonly _options: Required<Pick<IStandaloneCodeEditorOptions, 'lineNumbers' | 'fontSize' | 'lineHeight' | 'tabSize' | 'readOnly'>>;

	private readonly _root: HTMLElement;
	private readonly _gutter: HTMLElement;
	private readonly _scrollContainer: HTMLElement;
	private readonly _content: HTMLElement;
	private readonly _hiddenInput: HTMLTextAreaElement;

	private readonly _onDidChangeContent = this._register(new Emitter<IModelContentChangedEvent>());
	readonly onDidChangeContent: Event<IModelContentChangedEvent> = this._onDidChangeContent.event;

	private readonly _onDidChangeCursorPosition = this._register(new Emitter<ICodeEditorCursorPosition>());
	readonly onDidChangeCursorPosition: Event<ICodeEditorCursorPosition> = this._onDidChangeCursorPosition.event;

	private readonly _onDidFocusChange = this._register(new Emitter<boolean>());
	readonly onDidFocusChange: Event<boolean> = this._onDidFocusChange.event;

	private readonly _onDidChangeLanguage = this._register(new Emitter<string>());
	readonly onDidChangeLanguage: Event<string> = this._onDidChangeLanguage.event;

	private _focused = false;

	constructor(container: HTMLElement, options: IStandaloneCodeEditorOptions = {}) {
		super();
		this._options = {
			lineNumbers: options.lineNumbers ?? true,
			fontSize: options.fontSize ?? 14,
			lineHeight: options.lineHeight ?? 19,
			tabSize: Math.max(1, options.tabSize ?? 4),
			readOnly: options.readOnly ?? false,
		};
		this._model = new TextModel(URI.from({ scheme: 'untitled', path: 'code-editor' }), options.value ?? '');
		this._grammar = this._grammarRegistry.getGrammarForLanguageId(options.language ?? 'plaintext');

		this._root = $<HTMLElement>('div', 'dc-code-editor');
		this._root.style.cssText = 'position:relative;display:flex;flex-direction:row;width:100%;height:100%;background:#1e1e1e;color:#d4d4d4;overflow:hidden;user-select:none;';
		this._gutter = $<HTMLElement>('div', 'dc-code-editor-gutter');
		this._gutter.style.cssText = 'flex:0 0 auto;min-width:48px;text-align:right;padding-right:8px;color:#858585;overflow:hidden;border-right:1px solid #333;background:#1e1e1e;';
		this._scrollContainer = $<HTMLElement>('div', 'dc-code-editor-scroll');
		this._scrollContainer.style.cssText = 'flex:1 1 auto;overflow:auto;position:relative;';
		this._content = $<HTMLElement>('div', 'dc-code-editor-content');
		this._content.style.cssText = 'position:relative;min-height:100%;white-space:pre-wrap;word-break:normal;outline:none;font-family:Consolas,\'Courier New\',monospace;font-size:14px;line-height:19px;padding:0 12px 12px 0;caret-color:#aeafad;';
		this._content.contentEditable = 'true';
		this._content.setAttribute('role', 'textbox');
		this._content.setAttribute('aria-multiline', 'true');
		this._content.setAttribute('spellcheck', 'false');
		this._hiddenInput = $<HTMLTextAreaElement>('textarea', 'dc-code-editor-focus-trap');
		this._hiddenInput.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;opacity:0;';

		this._scrollContainer.appendChild(this._content);
		this._root.appendChild(this._gutter);
		this._root.appendChild(this._scrollContainer);
		this._root.appendChild(this._hiddenInput);
		container.appendChild(this._root);

		this._applyFont();
		this._renderAll();
		this._registerListeners();
	}

	public getValue(): string {
		return this._model.getValue();
	}

	public setValue(value: string): void {
		this._model.setValue(value);
		this._renderAll();
	}

	public getModel(): TextModel {
		return this._model;
	}

	public getLanguage(): string {
		return this._grammar.id;
	}

	public setLanguage(language: string): void {
		this._grammar = this._grammarRegistry.getGrammarForLanguageId(language);
		this._renderAll();
		this._onDidChangeLanguage.fire(this._grammar.id);
	}

	public getLineCount(): number {
		return this._model.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		return this._model.getLineContent(lineNumber);
	}

	public getCursorPosition(): ICodeEditorCursorPosition {
		return this._offsetToPosition(this._getCaretOffset());
	}

	public setCursorPosition(position: ICodeEditorCursorPosition): void {
		const offset = this._positionToOffset(position.lineNumber, position.column);
		this._setCaretOffset(offset);
		this._onDidChangeCursorPosition.fire(this._offsetToPosition(offset));
	}

	public getSelectedText(): string {
		const selection = window.getSelection();
		if (!selection || !this._content.contains(selection.anchorNode)) {
			return '';
		}
		return selection.toString();
	}

	public focus(): void {
		this._content.focus();
	}

	public blur(): void {
		this._content.blur();
	}

	public isFocused(): boolean {
		return this._focused;
	}

	public setReadOnly(readOnly: boolean): void {
		this._options.readOnly = readOnly;
		this._content.setAttribute('contenteditable', readOnly ? 'false' : 'true');
	}

	public isReadOnly(): boolean {
		return this._options.readOnly;
	}

	public layout(): void {
		this._syncGutterHeight();
		this._syncGutterScroll();
	}

	public getDomNode(): HTMLElement {
		return this._root;
	}

	override dispose(): void {
		this._root.remove();
		super.dispose();
	}

	private _registerListeners(): void {
		this._register(this._model.onDidChangeContent(e => {
			this._renderAll();
			this._onDidChangeContent.fire(e);
		}));
		this._register(addDisposableListener(this._content, 'input', () => {
			const text = this._content.textContent ?? '';
			if (text !== this._model.getValue()) {
				const caretOffset = this._getCaretOffset();
				this._model.setValue(text);
				this._setCaretOffset(Math.min(caretOffset, text.length));
			}
		}));
		this._register(addDisposableListener(this._content, 'keydown', e => this._handleKeyDown(e)));
		this._register(addDisposableListener(this._content, 'selectionchange', () => {
			this._onDidChangeCursorPosition.fire(this.getCursorPosition());
		}));
		this._register(addDisposableListener(this._content, 'focus', () => {
			this._focused = true;
			this._onDidFocusChange.fire(true);
		}));
		this._register(addDisposableListener(this._content, 'blur', () => {
			this._focused = false;
			this._onDidFocusChange.fire(false);
		}));
		this._register(addDisposableListener(this._scrollContainer, 'scroll', () => this._syncGutterScroll()));
		this._register(addDisposableListener(this._root, 'mousedown', e => {
			if (!this._content.contains(e.target as Node)) {
				e.preventDefault();
				this.focus();
			}
		}));
	}

	private _handleKeyDown(e: KeyboardEvent): void {
		const key = e.key;
		if (key === 'Tab') {
			e.preventDefault();
			const spaces = ' '.repeat(this._options.tabSize);
			if (e.shiftKey) {
				this._removeIndentAtCaret();
			} else {
				this._insertText(spaces);
			}
			return;
		}
		if (key === 'Enter') {
			if (this._options.readOnly) {
				e.preventDefault();
				return;
			}
			e.preventDefault();
			const indent = this._getIndentOfLineAtCaret();
			this._insertText('\n' + indent);
			return;
		}
	}

	private _insertText(text: string): void {
		document.execCommand('insertText', false, text);
		const caretOffset = this._getCaretOffset();
		const modelText = this._model.getValue();
		if (this._content.textContent !== modelText) {
			this._model.setValue(this._content.textContent ?? '');
		}
		this._setCaretOffset(caretOffset);
	}

	private _removeIndentAtCaret(): void {
		const position = this.getCursorPosition();
		const line = this._model.getLineContent(position.lineNumber);
		const removed = line.slice(0, position.column - 1).replace(/[ \t]+$/g, '');
		const removedCount = (position.column - 1) - removed.length;
		if (removedCount === 0) {
			return;
		}
		const text = this._model.getValue();
		const startOffset = this._positionToOffset(position.lineNumber, 1);
		const endOffset = this._positionToOffset(position.lineNumber, 1 + removedCount);
		this._model.setValue(text.slice(0, startOffset) + text.slice(endOffset));
		this._setCaretOffset(startOffset + removed.length);
	}

	private _getIndentOfLineAtCaret(): string {
		const position = this.getCursorPosition();
		const match = /^\s*/.exec(this._model.getLineContent(position.lineNumber));
		return match ? match[0] : '';
	}

	private _applyFont(): void {
		this._content.style.fontSize = `${this._options.fontSize}px`;
		this._content.style.lineHeight = `${this._options.lineHeight}px`;
	}

	private _renderAll(): void {
		clearNode(this._content);
		const lines = this._model.getValue().split('\n');
		let state: unknown = undefined;
		for (let i = 0; i < lines.length; i++) {
			const lineDiv = $<HTMLElement>('div', 'dc-code-editor-line');
			lineDiv.style.minHeight = `${this._options.lineHeight}px`;
			const result = this._grammar.tokenizeLine(lines[i], state);
			state = result.state;
			this._appendStyledLine(lineDiv, lines[i], result.tokens);
			this._content.appendChild(lineDiv);
		}
		this._renderGutter(lines.length);
		this._syncGutterHeight();
		this._syncGutterScroll();
	}

	private _appendStyledLine(container: HTMLElement, line: string, tokens: { startIndex: number; endIndex: number; scopes: string[] }[]): void {
		const expanded = expandTabs(line, this._options.tabSize);
		let lastIndex = 0;
		let html = '';
		for (const token of tokens) {
			if (token.startIndex > lastIndex) {
				html += this._escapeHtml(expanded.slice(lastIndex, token.startIndex));
			}
			const className = token.scopes.map(scopeToClass).join(' ');
			html += `<span class="${className}">${this._escapeHtml(expanded.slice(token.startIndex, token.endIndex))}</span>`;
			lastIndex = Math.max(lastIndex, token.endIndex);
		}
		if (lastIndex < expanded.length) {
			html += this._escapeHtml(expanded.slice(lastIndex));
		}
		container.innerHTML = html;
	}

	private _escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	private _renderGutter(lineCount: number): void {
		clearNode(this._gutter);
		const gutterLines = Math.max(lineCount, 1);
		for (let i = 1; i <= gutterLines; i++) {
			const numDiv = $<HTMLElement>('div', 'dc-code-editor-line-number');
			numDiv.style.lineHeight = `${this._options.lineHeight}px`;
			numDiv.textContent = String(i);
			this._gutter.appendChild(numDiv);
		}
	}

	private _syncGutterHeight(): void {
		this._gutter.style.height = `${Math.max(this._scrollContainer.clientHeight, this._model.getLineCount() * this._options.lineHeight)}px`;
	}

	private _syncGutterScroll(): void {
		this._gutter.scrollTop = this._scrollContainer.scrollTop;
	}

	private _getCaretOffset(): number {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return 0;
		}
		const range = selection.getRangeAt(0);
		const preRange = range.cloneRange();
		preRange.selectNodeContents(this._content);
		preRange.setEnd(range.startContainer, range.startOffset);
		return preRange.toString().length;
	}

	private _setCaretOffset(offset: number): void {
		const target = Math.max(0, Math.min(offset, this._content.textContent?.length ?? 0));
		const walker = document.createTreeWalker(this._content, NodeFilter.SHOW_TEXT);
		let current = 0;
		let node: Node | null;
		let resultNode: Node | null = null;
		let resultOffset = 0;
		while ((node = walker.nextNode()) !== null) {
			const length = node.textContent?.length ?? 0;
			if (current + length >= target) {
				resultNode = node;
				resultOffset = target - current;
				break;
			}
			current += length;
		}
		if (!resultNode) {
			resultNode = this._content;
			resultOffset = this._content.childNodes.length;
		}
		const range = document.createRange();
		range.setStart(resultNode, resultOffset);
		range.collapse(true);
		const selection = window.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	private _positionToOffset(lineNumber: number, column: number): number {
		let offset = 0;
		const lines = this._model.getValue().split('\n');
		for (let i = 1; i < Math.max(1, lineNumber); i++) {
			offset += (lines[i - 1]?.length ?? 0) + 1;
		}
		return offset + Math.max(0, column - 1);
	}

	private _offsetToPosition(offset: number): ICodeEditorCursorPosition {
		const lines = this._model.getValue().split('\n');
		let remaining = Math.max(0, offset);
		for (let i = 0; i < lines.length; i++) {
			const lineLength = lines[i].length + 1;
			if (remaining < lineLength || i === lines.length - 1) {
				return { lineNumber: i + 1, column: Math.min(remaining, lines[i].length) + 1 };
			}
			remaining -= lineLength;
		}
		return { lineNumber: 1, column: 1 };
	}
}

export function createStandaloneCodeEditor(container: HTMLElement, options?: IStandaloneCodeEditorOptions): StandaloneCodeEditor {
	return new StandaloneCodeEditor(container, options);
}
