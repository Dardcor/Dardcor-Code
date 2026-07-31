/**
 * Dardcor Code - Single Editor Group Tab Manager & Active Pane Controller
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { $ } from '../../../core/dom/element.js';
import { EditorInput } from './editor-input.js';
import { EditorTabBar } from './editor-tab-bar.js';
import { EditorGroupView } from './editor-group-view.js';
import { EditorPane, TextEditorPane } from './editor-pane.js';
import { EditorHistoryTracker } from './editor-history-tracker.js';

export type EditorPaneFactory = (container: HTMLElement, input: EditorInput) => EditorPane;

export interface IEditorGroupEvent {
	readonly group: EditorGroup;
	readonly input: EditorInput;
}

export interface IEditorGroupCloseEvent extends IEditorGroupEvent {
	readonly wasActive: boolean;
}

let groupCounter = 0;

export class EditorGroup extends Disposable {
	private readonly _id = `editor-group-${++groupCounter}`;
	private readonly _element: HTMLElement;
	private readonly _tabBar: EditorTabBar;
	private readonly _view: EditorGroupView;
	private readonly _history: EditorHistoryTracker;
	private readonly _inputs: EditorInput[] = [];
	private _activeInput: EditorInput | null = null;
	private _pane: EditorPane | null = null;
	private _paneFactory: EditorPaneFactory | null = null;

	private readonly _onDidOpenEditor = this._register(new Emitter<IEditorGroupEvent>());
	private readonly _onDidCloseEditor = this._register(new Emitter<IEditorGroupCloseEvent>());
	private readonly _onDidChangeActiveEditor = this._register(new Emitter<IEditorGroupEvent>());
	private readonly _onDidBeginTabDrag = this._register(new Emitter<IEditorGroupEvent>());
	private readonly _onDidEndTabDrag = this._register(new Emitter<IEditorGroupEvent>());

	readonly onDidOpenEditor: Event<IEditorGroupEvent> = this._onDidOpenEditor.event;
	readonly onDidCloseEditor: Event<IEditorGroupCloseEvent> = this._onDidCloseEditor.event;
	readonly onDidChangeActiveEditor: Event<IEditorGroupEvent> = this._onDidChangeActiveEditor.event;
	readonly onDidBeginTabDrag: Event<IEditorGroupEvent> = this._onDidBeginTabDrag.event;
	readonly onDidEndTabDrag: Event<IEditorGroupEvent> = this._onDidEndTabDrag.event;

	constructor(parent: HTMLElement | null = null) {
		super();
		this._element = $<HTMLElement>('div', 'dc-editor-group');
		this._element.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;background:#1e1e1e;';
		if (parent) {
			parent.appendChild(this._element);
		}

		this._tabBar = new EditorTabBar(this._element);
		this._view = new EditorGroupView(this._element);
		this._history = new EditorHistoryTracker();
		this._register(this._tabBar);
		this._register(this._view);
		this._register(this._history);

		this._tabBar.onDidSelectTab(input => this.setActiveEditor(input));
		this._tabBar.onDidCloseTab(input => this.closeEditor(input));
		this._tabBar.onDidBeginTabDrag(input => this._onDidBeginTabDrag.fire({ group: this, input }));
		this._tabBar.onDidEndTabDrag(input => this._onDidEndTabDrag.fire({ group: this, input }));
		this._history.onDidChange(() => this._syncDirtyStates());
	}

	get id(): string {
		return this._id;
	}

	get element(): HTMLElement {
		return this._element;
	}

	get tabBar(): EditorTabBar {
		return this._tabBar;
	}

	get view(): EditorGroupView {
		return this._view;
	}

	get activeEditor(): EditorInput | null {
		return this._activeInput;
	}

	get pane(): EditorPane | null {
		return this._pane;
	}

	get count(): number {
		return this._inputs.length;
	}

	getEditors(): EditorInput[] {
		return [...this._inputs];
	}

	contains(input: EditorInput): boolean {
		return this._inputs.some(i => i.matches(input));
	}

	openEditor(input: EditorInput): void {
		const existing = this._inputs.find(i => i.matches(input));
		if (existing) {
			this.setActiveEditor(existing);
			return;
		}
		this._inputs.push(input);
		this._tabBar.openTab(input);
		this._history.add(input);
		this._register(input);
		this.setActiveEditor(input);
		this._onDidOpenEditor.fire({ group: this, input });
	}

	setActiveEditor(input: EditorInput): void {
		if (this._activeInput?.matches(input)) {
			return;
		}
		this._activeInput = input;
		this._tabBar.setActive(input);
		this._history.setActive(input);
		this._openPaneFor(input);
		this._onDidChangeActiveEditor.fire({ group: this, input });
	}

	closeEditor(input: EditorInput): boolean {
		const idx = this._inputs.findIndex(i => i.matches(input));
		if (idx === -1) {
			return false;
		}
		this._inputs.splice(idx, 1);
		this._tabBar.closeTab(input);
		this._history.remove(input);
		const wasActive = this._activeInput !== null && this._activeInput.matches(input);

		if (wasActive) {
			this._activeInput = null;
			const next = this._history.getNext() ?? this._inputs[this._inputs.length - 1] ?? null;
			if (next) {
				this.setActiveEditor(next);
			} else {
				this._teardownPane();
			}
		}
		this._onDidCloseEditor.fire({ group: this, input, wasActive });
		input.dispose();
		return true;
	}

	closeAllEditors(): void {
		for (const input of [...this._inputs]) {
			this.closeEditor(input);
		}
	}

	navigateHistory(forward: boolean): void {
		const candidate = forward ? this._history.getNext() : this._history.getPrevious();
		if (candidate && candidate !== this._activeInput) {
			this.setActiveEditor(candidate);
		}
	}

	setPaneFactory(factory: EditorPaneFactory): void {
		this._paneFactory = factory;
	}

	focus(): void {
		this._view.focus();
	}

	private _openPaneFor(input: EditorInput): void {
		if (!this._pane) {
			const factory = this._paneFactory;
			this._pane = factory
				? factory(this._view.paneContainer, input)
				: new TextEditorPane(this._view.paneContainer);
			this._register(this._pane);
		}
		if (this._pane.input !== input) {
			this._pane.setInput(input);
		}
		this._view.attachPane(this._pane);
	}

	private _teardownPane(): void {
		if (this._pane) {
			this._pane.clearInput();
			this._view.clearPane();
		}
	}

	private _syncDirtyStates(): void {
		for (const input of this._inputs) {
			this._tabBar.setDirty(input, input.isDirty);
		}
	}

	dispose(): void {
		for (const input of this._inputs) {
			input.dispose();
		}
		this._inputs.length = 0;
		this._element.remove();
		super.dispose();
	}
}
