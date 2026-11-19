/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { isJsConfigOrTsConfigFileName } from '../configuration/languageDescription';
import { isSupportedLanguageMode } from '../configuration/languageIds';
import { Disposable } from '../utils/dispose';
import { coalesce } from '../utils/arrays';

export class ActiveJsTsEditorTracker extends Disposable {

	private _activeJsTsEditor: vscode.TextEditor | undefined;

	private readonly _onDidChangeActiveJsTsEditor = this._register(new vscode.EventEmitter<vscode.TextEditor | undefined>());
	public readonly onDidChangeActiveJsTsEditor = this._onDidChangeActiveJsTsEditor.event;

	public constructor() {
		super();

		this._register(vscode.window.onDidChangeActiveTextEditor(_ => this.update()));
		this._register(vscode.window.onDidChangeVisibleTextEditors(_ => this.update()));
		this._register(vscode.window.tabGroups.onDidChangeTabGroups(_ => this.update()));

		this.update();
	}

	public get activeJsTsEditor(): vscode.TextEditor | undefined {
		return this._activeJsTsEditor;
	}


	private update() {
		const editorCandidates = this.getEditorCandidatesForActiveTab();
		const managedEditors = editorCandidates.filter(editor => this.isManagedFile(editor));
		const newActiveJsTsEditor = managedEditors.at(0);
		if (this._activeJsTsEditor !== newActiveJsTsEditor) {
			this._activeJsTsEditor = newActiveJsTsEditor;
			this._onDidChangeActiveJsTsEditor.fire(this._activeJsTsEditor);
		}
	}

	private getEditorCandidatesForActiveTab(): vscode.TextEditor[] {
		const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
		if (!tab) {
			return [];
		}

		if (tab.input instanceof vscode.TabInputText) {
			const inputUri = tab.input.uri;
			const editor = vscode.window.visibleTextEditors.find(editor => {
				return editor.document.uri.toString() === inputUri.toString()
					&& editor.viewColumn === tab.group.viewColumn;
			});
			return editor ? [editor] : [];
		}

		if (tab.input instanceof vscode.TabInputTextDiff) {
			const original = tab.input.original;
			const modified = tab.input.modified;
			return coalesce([vscode.window.activeTextEditor, ...vscode.window.visibleTextEditors]).filter(editor => {
				return (editor.document.uri.toString() === original.toString() || editor.document.uri.toString() === modified.toString())
					&& editor.viewColumn === undefined;
			});
		}

		if (tab.input instanceof vscode.TabInputNotebook) {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return [];
			}

			if (activeEditor.viewColumn !== undefined) {
				return [];
			}

			const notebook = vscode.window.visibleNotebookEditors.find(editor =>
				editor.notebook.uri.toString() === (tab.input as vscode.TabInputNotebook).uri.toString()
				&& editor.viewColumn === tab.group.viewColumn);

			return notebook?.notebook.getCells().some(cell => cell.document.uri.toString() === activeEditor.document.uri.toString()) ? [activeEditor] : [];
		}

		return [];
	}

	private isManagedFile(editor: vscode.TextEditor): boolean {
		return this.isManagedScriptFile(editor) || this.isManagedConfigFile(editor);
	}

	private isManagedScriptFile(editor: vscode.TextEditor): boolean {
		return isSupportedLanguageMode(editor.document);
	}

	private isManagedConfigFile(editor: vscode.TextEditor): boolean {
		return isJsConfigOrTsConfigFileName(editor.document.fileName);
	}
}
