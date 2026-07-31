/**
 * Dardcor Code - Center Tabbed Editor Group Split Container
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { GridLayout, Direction } from '../../layout/grid-layout.js';
import { EditorGroup, IEditorGroupEvent, IEditorGroupCloseEvent, EditorPaneFactory } from './editor-group.js';
import { EditorInput } from './editor-input.js';
import { EditorDropTarget, DropDirection, IDropEvent } from './editor-drop-target.js';
import { EditorPane } from './editor-pane.js';

export interface IEditorPartOpenEvent {
	readonly group: EditorGroup;
	readonly input: EditorInput;
}

export class EditorPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _grid: GridLayout;
	private readonly _dropTarget: EditorDropTarget;
	private readonly _groups: EditorGroup[] = [];
	private _activeGroup: EditorGroup | null = null;
	private _paneFactory: EditorPaneFactory | null = null;

	private readonly _onDidChangeActiveGroup = this._register(new Emitter<EditorGroup | null>());
	private readonly _onDidChangeActiveEditor = this._register(new Emitter<IEditorPartOpenEvent | null>());
	private readonly _onDidOpenEditor = this._register(new Emitter<IEditorPartOpenEvent>());
	private readonly _onDidCloseEditor = this._register(new Emitter<IEditorGroupCloseEvent>());
	private readonly _onDidBeginTabDrag = this._register(new Emitter<IEditorGroupEvent>());

	readonly onDidChangeActiveGroup: Event<EditorGroup | null> = this._onDidChangeActiveGroup.event;
	readonly onDidChangeActiveEditor: Event<IEditorPartOpenEvent | null> = this._onDidChangeActiveEditor.event;
	readonly onDidOpenEditor: Event<IEditorPartOpenEvent> = this._onDidOpenEditor.event;
	readonly onDidCloseEditor: Event<IEditorGroupCloseEvent> = this._onDidCloseEditor.event;
	readonly onDidBeginTabDrag: Event<IEditorGroupEvent> = this._onDidBeginTabDrag.event;

	constructor(container: HTMLElement) {
		super();
		this._container = container;
		container.style.cssText = 'position:relative;overflow:hidden;flex:1;';

		this._grid = new GridLayout(container);
		this._register(this._grid);

		this._dropTarget = new EditorDropTarget(container);
		this._register(this._dropTarget);
		this._dropTarget.onDidDrop(ev => this._onDrop(ev));
	}

	get activeGroup(): EditorGroup | null {
		return this._activeGroup;
	}

	getGroups(): EditorGroup[] {
		return [...this._groups];
	}

	get groupCount(): number {
		return this._groups.length;
	}

	openEditor(input: EditorInput, group?: EditorGroup): void {
		const target = group ?? this._activeGroup ?? this._ensureGroup();
		target.openEditor(input);
		this._setActiveGroup(target);
		this._onDidOpenEditor.fire({ group: target, input });
	}

	closeEditor(input: EditorInput): boolean {
		for (const group of this._groups) {
			if (group.contains(input)) {
				return this._closeInGroup(group, input);
			}
		}
		return false;
	}

	closeAllEditors(): void {
		for (const group of [...this._groups]) {
			group.closeAllEditors();
		}
	}

	splitEditor(direction: Direction): EditorGroup {
		const group = this._createGroup();
		this._grid.addView(group.element, this._activeGroup?.id, direction, 0.5);
		this._setActiveGroup(group);
		return group;
	}

	removeGroup(group: EditorGroup): void {
		const idx = this._groups.indexOf(group);
		if (idx === -1) {
			return;
		}
		this._grid.removeView(group.id);
		this._groups.splice(idx, 1);
		group.dispose();
		if (this._activeGroup === group) {
			this._setActiveGroup(this._groups[0] ?? null);
		}
	}

	setActiveGroup(group: EditorGroup): void {
		this._setActiveGroup(group);
	}

	setPaneFactory(factory: EditorPaneFactory): void {
		this._paneFactory = factory;
		for (const group of this._groups) {
			group.setPaneFactory(factory);
		}
	}

	focusActiveGroup(): void {
		this._activeGroup?.focus();
	}

	private _ensureGroup(): EditorGroup {
		if (this._groups.length === 0) {
			return this._createGroup();
		}
		return this._activeGroup ?? this._groups[0];
	}

	private _createGroup(): EditorGroup {
		const group = new EditorGroup();
		this._register(group);
		if (this._paneFactory) {
			group.setPaneFactory(this._paneFactory);
		}
		group.onDidChangeActiveEditor(e => {
			if (group === this._activeGroup) {
				this._onDidChangeActiveEditor.fire({ group, input: e.input });
			}
		});
		group.onDidCloseEditor(e => {
			this._onDidCloseEditor.fire(e);
			if (group === this._activeGroup && e.wasActive) {
				if (group.activeEditor) {
					this._onDidChangeActiveEditor.fire({ group, input: group.activeEditor });
				} else {
					this._onDidChangeActiveEditor.fire(null);
				}
			}
			if (group.count === 0 && this._groups.length > 1) {
				this.removeGroup(group);
			}
		});
		group.onDidBeginTabDrag(e => this._onDidBeginTabDrag.fire(e));

		if (this._groups.length === 0) {
			this._grid.addView(group.element, undefined, Direction.Right, 1);
		}
		this._groups.push(group);
		return group;
	}

	private _setActiveGroup(group: EditorGroup | null): void {
		if (this._activeGroup === group) {
			return;
		}
		this._activeGroup = group;
		this._onDidChangeActiveGroup.fire(group);
		if (group) {
			if (group.activeEditor) {
				this._onDidChangeActiveEditor.fire({ group, input: group.activeEditor });
			} else {
				this._onDidChangeActiveEditor.fire(null);
			}
		} else {
			this._onDidChangeActiveEditor.fire(null);
		}
	}

	private _closeInGroup(group: EditorGroup, input: EditorInput): boolean {
		const closed = group.closeEditor(input);
		if (group.count === 0 && this._groups.length > 1) {
			this.removeGroup(group);
		}
		return closed;
	}

	private _onDrop(ev: IDropEvent): void {
		let draggedInput: EditorInput | null = null;
		for (const group of this._groups) {
			for (const input of group.getEditors()) {
				if (input.toKey() === ev.data) {
					draggedInput = input;
					break;
				}
			}
			if (draggedInput) {
				break;
			}
		}
		if (!draggedInput) {
			return;
		}
		const sourceGroup = this._groups.find(g => g.contains(draggedInput!));
		if (ev.direction === DropDirection.Center && this._activeGroup) {
			this._activeGroup.openEditor(draggedInput!);
			return;
		}
		const direction = this._directionFromDrop(ev.direction);
		const targetGroup = this.splitEditor(direction);
		targetGroup.openEditor(draggedInput!);
		sourceGroup?.closeEditor(draggedInput!);
	}

	private _directionFromDrop(direction: DropDirection): Direction {
		switch (direction) {
			case DropDirection.Top:
				return Direction.Up;
			case DropDirection.Bottom:
				return Direction.Down;
			case DropDirection.Left:
				return Direction.Left;
			default:
				return Direction.Right;
		}
	}

	dispose(): void {
		for (const group of this._groups) {
			group.dispose();
		}
		this._groups.length = 0;
		super.dispose();
	}
}
