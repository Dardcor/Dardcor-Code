/**
 * Dardcor Code - Editor Component Container Base Class
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { $ } from '../../../core/dom/element';
import { CodeEditor } from '../../../engine/controller/editor-controller';
import { EditorInput } from './editor-input';

export abstract class EditorPane extends Disposable {
	protected readonly _container: HTMLElement;
	protected _input: EditorInput | null = null;

	constructor(parent: HTMLElement) {
		super();
		this._container = $<HTMLElement>('div', 'dc-editor-pane');
		this._container.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#1e1e1e;';
		parent.appendChild(this._container);
	}

	get input(): EditorInput | null {
		return this._input;
	}

	getContainer(): HTMLElement {
		return this._container;
	}

	abstract setInput(input: EditorInput): void;
	abstract clearInput(): void;
	abstract focus(): void;

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}

export class TextEditorPane extends EditorPane {
	private readonly _codeEditor: CodeEditor;

	constructor(parent: HTMLElement) {
		super(parent);
		this._codeEditor = new CodeEditor(this._container);
	}

	setInput(input: EditorInput): void {
		this._input = input;
		this._codeEditor.setModel(input.getTextModel());
	}

	clearInput(): void {
		this._input = null;
		this._codeEditor.setModel(null);
	}

	focus(): void {
		this._codeEditor.focus();
	}
}
