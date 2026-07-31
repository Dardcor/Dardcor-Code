/**
 * Dardcor Code - Sync Mirror of Active Text Editor Windows (Task 634)
 * Mirrors: vs/workbench/api/common/extHostTextEditors.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { RPCProtocol, IRPCChannelHandler } from '../host/rpc-protocol';
import { ExtHostDocuments } from './ext-host-documents';
import { TextEditor, ITextEditorData } from './ext-host-text-editor';

/**
 * Tracks the active and visible text editors on the main side. The main
 * side pushes editor state changes through the `editors` RPC channel.
 */
export class ExtHostEditors extends Disposable {
	private readonly _editors = new Map<string, TextEditor>();
	private _activeEditor: TextEditor | undefined;

	private readonly _onDidChangeActiveEditor = this._register(new Emitter<TextEditor | undefined>());
	readonly onDidChangeActiveTextEditor: Event<TextEditor | undefined> = this._onDidChangeActiveEditor.event;

	private readonly _onDidChangeVisibleEditors = this._register(new Emitter<TextEditor[]>());
	readonly onDidChangeVisibleTextEditors: Event<TextEditor[]> = this._onDidChangeVisibleEditors.event;

	constructor(
		private readonly _rpc: RPCProtocol,
		private readonly _documents: ExtHostDocuments
	) {
		super();
	}

	public get activeTextEditor(): TextEditor | undefined {
		return this._activeEditor;
	}

	public get visibleTextEditors(): TextEditor[] {
		return [...this._editors.values()].filter(e => e.visible);
	}

	public getTextEditor(uri: string): TextEditor | undefined {
		return this._editors.get(uri);
	}

	public getAllTextEditors(): TextEditor[] {
		return [...this._editors.values()];
	}

	public setActiveEditor(uri: string | undefined): void {
		const next = uri === undefined ? undefined : this._editors.get(uri);
		if (next !== this._activeEditor) {
			this._activeEditor = next;
			if (next) {
				next.updateFromData({ active: true });
			}
			this._onDidChangeActiveEditor.fire(next);
		}
	}

	public updateEditor(data: ITextEditorData): void {
		let editor = this._editors.get(data.uri);
		if (!editor) {
			const document = this._documents.getDocument(data.uri);
			if (!document) {
				return;
			}
			editor = new TextEditor(this._rpc, document, data);
			this._editors.set(data.uri, editor);
		} else {
			editor.updateFromData(data);
		}
		if (data.active) {
			this.setActiveEditor(data.uri);
		}
		this._onDidChangeVisibleEditors.fire(this.visibleTextEditors);
	}

	public removeEditor(uri: string): void {
		this._editors.delete(uri);
		if (this._activeEditor?.document.uri.toString() === uri) {
			this.setActiveEditor(this.visibleTextEditors[0]?.document.uri.toString());
		}
		this._onDidChangeVisibleEditors.fire(this.visibleTextEditors);
	}

	public get channelHandler(): IRPCChannelHandler {
		return {
			call: (command: string, payload: any) => {
				switch (command) {
					case '$setActive':
						this.setActiveEditor(payload?.uri);
						return this._activeEditor?.toJSON();
					case '$update':
						this.updateEditor(payload as ITextEditorData);
						return undefined;
					case '$remove':
						this.removeEditor(payload.uri);
						return undefined;
					case '$getAll':
						return this.getAllTextEditors().map(e => e.toJSON());
					default:
						throw new Error(`Perintah editors tidak dikenal: ${command}`);
				}
			},
			notify: (command: string, payload: any) => {
				if (command === '$update') {
					this.updateEditor(payload as ITextEditorData);
				} else if (command === '$setActive') {
					this.setActiveEditor(payload?.uri);
				} else if (command === '$remove') {
					this.removeEditor(payload.uri);
				}
			}
		};
	}
}
