import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostNotebookEditor {
	private readonly _editors = new Map<string, any>();

	private readonly _onDidChangeActiveNotebookEditor = new Emitter<any>();
	readonly onDidChangeActiveNotebookEditor = this._onDidChangeActiveNotebookEditor.event;

	private readonly _onDidChangeVisibleNotebookEditors = new Emitter<any[]>();
	readonly onDidChangeVisibleNotebookEditors = this._onDidChangeVisibleNotebookEditors.event;

	get activeNotebookEditor(): any | undefined {
		return Array.from(this._editors.values())[0];
	}

	get visibleNotebookEditors(): any[] {
		return Array.from(this._editors.values());
	}
}
