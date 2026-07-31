/**
 * Dardcor Code - Embedded Child Editor Inside Peek View
 */

import { Disposable } from "../../../core/lifecycle/disposable.js";
import { Emitter, Event } from "../../../core/events/emitter.js";
import { $, clearNode, addDisposableListener } from "../../../core/dom/element.js";
import { ITextModel, IRange } from "../../model/text-model.js";

export interface IPeekViewEditorHost {
	getContainer(): HTMLElement;
	onDidEditText?(text: string): void;
}

export class PeekViewEditor extends Disposable {
	private readonly _host: IPeekViewEditorHost;
	private readonly _domNode: HTMLElement;
	private readonly _gutterNode: HTMLElement;
	private readonly _contentNode: HTMLElement;
	private _model: ITextModel | null = null;
	private _highlightRange: IRange | null = null;
	private _lineHeight: number = 19;
	private _isEditable: boolean = false;
	private _editorNode: HTMLElement | null = null;

	private readonly _onDidChangeSelection = this._register(new Emitter<IRange>());
	readonly onDidChangeSelection: Event<IRange> = this._onDidChangeSelection.event;

	private readonly _onDidEdit = this._register(new Emitter<string>());
	readonly onDidEdit: Event<string> = this._onDidEdit.event;

	constructor(host: IPeekViewEditorHost) {
		super();
		this._host = host;
		this._domNode = $<HTMLElement>("div", "dc-peek-view-editor");
		this._gutterNode = $<HTMLElement>("div", "dc-peek-view-editor-gutter");
		this._contentNode = $<HTMLElement>("div", "dc-peek-view-editor-content");

		this._domNode.style.cssText = "display:flex;height:100%;font-family:Consolas, monospace;font-size:13px;line-height:19px;color:#d4d4d4;overflow:hidden;";
		this._gutterNode.style.cssText = "flex:none;width:44px;text-align:right;padding-right:8px;color:#6a6a6a;user-select:none;overflow:hidden;border-right:1px solid #3a3a3a;";
		this._contentNode.style.cssText = "flex:1;overflow:auto;position:relative;";
		this._domNode.appendChild(this._gutterNode);
		this._domNode.appendChild(this._contentNode);
		host.getContainer().appendChild(this._domNode);
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this._highlightRange = null;
		this.render();
	}

	public getModel(): ITextModel | null {
		return this._model;
	}

	public render(): void {
		const model = this._model;
		if (!model) {
			clearNode(this._gutterNode);
			clearNode(this._contentNode);
			return;
		}
		if (this._isEditable) {
			this._renderEditor();
			return;
		}
		clearNode(this._gutterNode);
		clearNode(this._contentNode);
		const lineCount = model.getLineCount();
		const maxLineDigits = String(lineCount).length;
		for (let line = 1; line <= lineCount; line++) {
			const lineNumber = $<HTMLElement>("span", "dc-peek-view-line-number");
			lineNumber.textContent = String(line).padStart(maxLineDigits, "0");
			lineNumber.style.cssText = "display:block;height:19px;";
			this._gutterNode.appendChild(lineNumber);

			const row = $<HTMLElement>("div", "dc-peek-view-line");
			row.style.cssText = `height:19px;white-space:pre;padding-left:8px;cursor:pointer;`;
			row.textContent = model.getLineContent(line) || " ";
			row.setAttribute("data-line", String(line));
			if (this._highlightRange && line >= this._highlightRange.startLineNumber && line <= this._highlightRange.endLineNumber) {
				row.style.background = "rgba(38, 79, 120, 0.45)";
			}
			this._register(addDisposableListener(row, "mousedown", e => {
				e.preventDefault();
				this.setSelection({
					startLineNumber: line,
					startColumn: 1,
					endLineNumber: line,
					endColumn: Math.max(1, (model.getLineContent(line) || "").length + 1)
				});
			}));
			this._contentNode.appendChild(row);
		}
	}

	public setHighlight(range: IRange | null): void {
		this._highlightRange = range;
		this.render();
	}

	public setSelection(range: IRange | null): void {
		this._highlightRange = range;
		this._onDidChangeSelection.fire(range ?? {
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: 1,
			endColumn: 1
		});
		this.render();
	}

	public revealLine(lineNumber: number): void {
		const target = this._contentNode.querySelector(`.dc-peek-view-line[data-line="${lineNumber}"]`) as HTMLElement | null;
		if (target) {
			this._contentNode.scrollTop = Math.max(0, target.offsetTop - this._contentNode.clientHeight / 2 + this._lineHeight);
		}
	}

	public setEditable(editable: boolean): void {
		this._isEditable = editable;
		this.render();
	}

	public get isEditable(): boolean {
		return this._isEditable;
	}

	private _renderEditor(): void {
		const model = this._model;
		if (!model) {
			return;
		}
		clearNode(this._gutterNode);
		clearNode(this._contentNode);
		const textarea = $<HTMLTextAreaElement>("textarea", "dc-peek-view-editor-textarea");
		textarea.value = model.getValue();
		textarea.spellcheck = false;
		textarea.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:transparent;border:none;outline:none;resize:none;color:#d4d4d4;font-family:Consolas, monospace;font-size:13px;line-height:19px;padding:0 8px;white-space:pre;overflow:auto;";
		this._editorNode = textarea;
		this._contentNode.appendChild(textarea);
		this._register(addDisposableListener(textarea, "input", () => {
			const next = textarea.value;
			if (model.getValue() !== next) {
				model.setValue(next);
				this._onDidEdit.fire(next);
				this._host.onDidEditText?.(next);
			}
		}));
		textarea.focus();
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getLineHeight(): number {
		return this._lineHeight;
	}

	public override dispose(): void {
		this._domNode.remove();
		super.dispose();
	}
}
