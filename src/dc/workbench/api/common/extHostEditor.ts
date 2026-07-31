import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostEditor {
	private readonly _editors = new Map<string, any>();

	private readonly _onDidChangeActiveTextEditor = new Emitter<any>();
	readonly onDidChangeActiveTextEditor = this._onDidChangeActiveTextEditor.event;

	private readonly _onDidChangeVisibleTextEditors = new Emitter<any[]>();
	readonly onDidChangeVisibleTextEditors = this._onDidChangeVisibleTextEditors.event;

	private readonly _onDidChangeTextEditorSelection = new Emitter<any>();
	readonly onDidChangeTextEditorSelection = this._onDidChangeTextEditorSelection.event;

	private readonly _onDidChangeTextEditorVisibleRanges = new Emitter<any>();
	readonly onDidChangeTextEditorVisibleRanges = this._onDidChangeTextEditorVisibleRanges.event;

	private readonly _onDidChangeTextEditorOptions = new Emitter<any>();
	readonly onDidChangeTextEditorOptions = this._onDidChangeTextEditorOptions.event;

	private readonly _onDidChangeTextEditorViewColumn = new Emitter<any>();
	readonly onDidChangeTextEditorViewColumn = this._onDidChangeTextEditorViewColumn.event;

	get activeTextEditor(): any | undefined {
		return Array.from(this._editors.values())[0];
	}

	get visibleTextEditors(): any[] {
		return Array.from(this._editors.values());
	}
}
