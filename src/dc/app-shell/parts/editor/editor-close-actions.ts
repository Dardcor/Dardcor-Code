/**
 * Dardcor Code - Close Editor, Close Saved Editors, Close All Editors Actions
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { EditorPart } from './editor-part.js';
import { EditorGroup } from './editor-group.js';
import { EditorInput } from './editor-input.js';
import { CommandRegistry } from '../../../services/commands/command-service.js';

export interface IEditorCloseEvent {
	readonly input: EditorInput;
	readonly reason: 'close' | 'closeOthers' | 'closeSaved' | 'closeAll';
}

export interface IEditorCloseActionsOptions {
	readonly closeEmptyGroups?: boolean;
}

export class EditorCloseActions extends Disposable {
	private readonly _editorPart: EditorPart;
	private readonly _options: IEditorCloseActionsOptions;

	private readonly _onDidClose = this._register(new Emitter<IEditorCloseEvent>());
	readonly onDidClose: Event<IEditorCloseEvent> = this._onDidClose.event;

	constructor(editorPart: EditorPart, options: IEditorCloseActionsOptions = {}) {
		super();
		this._editorPart = editorPart;
		this._options = options;

		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.closeActiveEditor',
			handler: () => this.closeActiveEditor(),
		}));
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.closeAllEditors',
			handler: () => this.closeAllEditors(),
		}));
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.closeSavedEditors',
			handler: () => this.closeSavedEditors(),
		}));
		this._register(CommandRegistry.registerCommand({
			id: 'workbench.action.closeEditorsInGroup',
			handler: () => this.closeAllInActiveGroup(),
		}));
	}

	closeActiveEditor(): boolean {
		const group = this._editorPart.activeGroup;
		const input = group?.activeEditor ?? null;
		if (!input || !group) {
			return false;
		}
		const closed = group.closeEditor(input);
		if (closed) {
			this._onDidClose.fire({ input, reason: 'close' });
		}
		return closed;
	}

	closeEditor(input: EditorInput): boolean {
		const closed = this._editorPart.closeEditor(input);
		if (closed) {
			this._onDidClose.fire({ input, reason: 'close' });
		}
		return closed;
	}

	closeAllEditors(): number {
		let count = 0;
		for (const group of this._editorPart.getGroups()) {
			for (const input of [...group.getEditors()]) {
				if (group.closeEditor(input)) {
					count++;
					this._onDidClose.fire({ input, reason: 'closeAll' });
				}
			}
		}
		return count;
	}

	closeSavedEditors(): number {
		let count = 0;
		for (const group of this._editorPart.getGroups()) {
			for (const input of [...group.getEditors()]) {
				if (!input.isDirty && group.closeEditor(input)) {
					count++;
					this._onDidClose.fire({ input, reason: 'closeSaved' });
				}
			}
		}
		return count;
	}

	closeAllInActiveGroup(): number {
		const group = this._editorPart.activeGroup;
		if (!group) {
			return 0;
		}
		return this.closeGroup(group);
	}

	closeGroup(group: EditorGroup): number {
		let count = 0;
		for (const input of [...group.getEditors()]) {
			if (group.closeEditor(input)) {
				count++;
				this._onDidClose.fire({ input, reason: 'closeAll' });
			}
		}
		return count;
	}

	closeOthers(input: EditorInput): number {
		const group = this._editorPart.getGroups().find(g => g.contains(input));
		if (!group) {
			return 0;
		}
		let count = 0;
		for (const candidate of [...group.getEditors()]) {
			if (!candidate.matches(input) && group.closeEditor(candidate)) {
				count++;
				this._onDidClose.fire({ input: candidate, reason: 'closeOthers' });
			}
		}
		return count;
	}

	closeToTheRight(input: EditorInput): number {
		const group = this._editorPart.getGroups().find(g => g.contains(input));
		if (!group) {
			return 0;
		}
		const editors = group.getEditors();
		const idx = editors.findIndex(e => e.matches(input));
		if (idx === -1) {
			return 0;
		}
		let count = 0;
		for (const candidate of editors.slice(idx + 1)) {
			if (group.closeEditor(candidate)) {
				count++;
				this._onDidClose.fire({ input: candidate, reason: 'closeOthers' });
			}
		}
		return count;
	}

	dispose(): void {
		super.dispose();
	}
}
