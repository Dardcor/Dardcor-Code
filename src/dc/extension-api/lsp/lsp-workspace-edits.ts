import { IDisposable, toDisposable } from '../../core/lifecycle/disposable.js';
import { LspClient } from './lsp-client.js';
import { ILspTextEdit } from './lsp-converters.js';

export interface LspWorkspaceEdit {
	changes?: Record<string, ILspTextEdit[]>;
	documentChanges?: Array<{
		textDocument?: { uri: string; version?: number | null };
		edits?: ILspTextEdit[];
		kind?: 'create' | 'rename' | 'delete';
		uri?: string;
		options?: Record<string, unknown>;
	}>;
}

export class LspWorkspaceEdits {
	private _client: LspClient | undefined;
	private _callback: ((uri: string, edits: ILspTextEdit[]) => void) | undefined;

	public register(client: LspClient): IDisposable {
		this._client = client;
		const applyEditHandler = client.onRequest('workspace/applyEdit', (params: any) => {
			if (params && params.edit && this._callback) {
				this.applyWorkspaceEdit(params.edit, this._callback);
			}
			return { applied: true };
		});
		return toDisposable(() => {
			applyEditHandler.dispose();
			if (this._client === client) {
				this._client = undefined;
			}
		});
	}

	public applyWorkspaceEdit(edit: LspWorkspaceEdit, callback: (uri: string, edits: ILspTextEdit[]) => void): void {
		this._callback = callback;
		if (edit.changes) {
			for (const [uri, edits] of Object.entries(edit.changes)) {
				if (edits.length > 0) {
					callback(uri, edits);
				}
			}
		}
		for (const change of edit.documentChanges ?? []) {
			if (change.textDocument && change.edits && change.edits.length > 0) {
				callback(change.textDocument.uri, change.edits);
			}
		}
	}
}
