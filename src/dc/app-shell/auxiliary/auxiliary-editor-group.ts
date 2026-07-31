/**
 * Dardcor Code - Floating Editor Group Instance Inside Child Window
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { AuxiliaryWindowElement, IAuxiliaryWindowOptions } from './auxiliary-window-element.js';
import { EditorGroup, EditorPaneFactory, IEditorGroupEvent } from '../parts/editor/editor-group.js';
import { EditorInput } from '../parts/editor/editor-input.js';

export interface IAuxiliaryEditorGroupOptions extends IAuxiliaryWindowOptions {
	readonly paneFactory?: EditorPaneFactory | null;
}

export class AuxiliaryEditorGroup extends Disposable {
	private readonly _windowElement: AuxiliaryWindowElement;
	private readonly _group: EditorGroup;
	private readonly _syncBar: HTMLElement | null = null;

	private readonly _onDidChangeActiveEditor = this._register(new Emitter<IEditorGroupEvent>());
	readonly onDidChangeActiveEditor: Event<IEditorGroupEvent> = this._onDidChangeActiveEditor.event;

	private readonly _onDidOpenEditor = this._register(new Emitter<IEditorGroupEvent>());
	readonly onDidOpenEditor: Event<IEditorGroupEvent> = this._onDidOpenEditor.event;

	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose: Event<void> = this._onDidClose.event;

	constructor(options: IAuxiliaryEditorGroupOptions) {
		super();
		this._windowElement = new AuxiliaryWindowElement(options);
		this._register(this._windowElement);
		this._group = new EditorGroup();
		this._register(this._group);

		if (options.paneFactory) {
			this._group.setPaneFactory(options.paneFactory);
		}

		this._group.onDidChangeActiveEditor(e => this._onDidChangeActiveEditor.fire(e));
		this._group.onDidOpenEditor(e => this._onDidOpenEditor.fire(e));
		this._windowElement.onDidClose(() => this._onDidClose.fire());

		this._windowElement.open();
		this._mount();
		this._syncTitle();
	}

	get id(): string {
		return this._windowElement.id;
	}

	get windowElement(): AuxiliaryWindowElement {
		return this._windowElement;
	}

	get group(): EditorGroup {
		return this._group;
	}

	get activeEditor(): EditorInput | null {
		return this._group.activeEditor;
	}

	openEditor(input: EditorInput): void {
		this._group.openEditor(input);
		this._syncTitle();
		this._windowElement.focus();
	}

	setActiveEditor(input: EditorInput): void {
		this._group.setActiveEditor(input);
		this._syncTitle();
	}

	closeEditor(input: EditorInput): boolean {
		const closed = this._group.closeEditor(input);
		this._syncTitle();
		return closed;
	}

	focus(): void {
		this._windowElement.focus();
		this._group.focus();
	}

	close(): void {
		this._windowElement.close();
	}

	setTitle(title: string): void {
		this._windowElement.setTitle(title);
	}

	private _mount(): void {
		const container = this._windowElement.container;
		if (!container) {
			return;
		}
		container.appendChild(this._group.element);
		this._group.element.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;background:#1e1e1e;';
	}

	private _syncTitle(): void {
		const active = this._group.activeEditor;
		if (active) {
			this._windowElement.setTitle(`${active.getName()} - Dardcor Code`);
		}
	}

	dispose(): void {
		this._windowElement.close();
		super.dispose();
	}
}
