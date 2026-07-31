/**
 * Dardcor Code - CodeEditor Component Controller
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { ITextModel } from '../model/text-model';
import { $ } from '../../core/dom/element';
import { Emitter, Event } from '../../core/events/emitter';

export interface ICodeEditor {
	setModel(model: ITextModel | null): void;
	getModel(): ITextModel | null;
	focus(): void;
	onDidChangeModel: Event<ITextModel | null>;
	getContainer(): HTMLElement;
}

export class CodeEditor extends Disposable implements ICodeEditor {
	private _model: ITextModel | null = null;
	private readonly _container: HTMLElement;
	private readonly _editorDom: HTMLElement;
	private readonly _linesDom: HTMLElement;
	private readonly _textarea: HTMLTextAreaElement;

	private readonly _onDidChangeModel = this._register(new Emitter<ITextModel | null>());
	readonly onDidChangeModel = this._onDidChangeModel.event;

	constructor(container: HTMLElement) {
		super();
		this._container = container;
		this._editorDom = $<HTMLElement>('div', 'dc-code-editor');
		this._linesDom = $<HTMLElement>('div', 'dc-editor-lines');
		this._textarea = $<HTMLTextAreaElement>('textarea', 'dc-hidden-input');

		this._editorDom.appendChild(this._linesDom);
		this._editorDom.appendChild(this._textarea);
		this._container.appendChild(this._editorDom);

		this._registerListeners();
		this._applyStyles();
	}

	public setModel(model: ITextModel | null): void {
		this._model = model;
		this._render();
		this._onDidChangeModel.fire(model);
	}

	public getModel(): ITextModel | null {
		return this._model;
	}

	public focus(): void {
		this._textarea.focus();
	}

	public getContainer(): HTMLElement {
		return this._container;
	}

	private _registerListeners(): void {
		this._textarea.addEventListener('input', () => {
			if (this._model) {
				this._model.setValue(this._textarea.value);
			}
		});
	}

	private _render(): void {
		if (!this._model) {
			this._linesDom.textContent = '';
			return;
		}
		const content = this._model.getValue();
		this._textarea.value = content;
		const lines = content.split('\n');
		this._linesDom.innerHTML = lines
			.map((line, idx) => `<div class="dc-line"><span class="dc-line-num">${idx + 1}</span><span class="dc-line-content">${this._escape(line)}</span></div>`)
			.join('');
	}

	private _escape(str: string): string {
		return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	private _applyStyles(): void {
		this._editorDom.style.cssText = 'position:relative;width:100%;height:100%;background:#1e1e1e;color:#d4d4d4;font-family:Consolas, monospace;font-size:14px;overflow:auto;';
		this._textarea.style.cssText = 'position:absolute;top:-9999px;left:-9999px;opacity:0;';
	}
}
