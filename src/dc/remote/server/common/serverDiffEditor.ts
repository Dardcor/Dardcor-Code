import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export interface IServerDiffEditorModel {
	readonly originalUri: string;
	readonly modifiedUri: string;
}

export interface IServerDiffEditorService {
	readonly onDidChangeDiffEditors: Event<void>;
	openDiffEditor(originalUri: string, modifiedUri: string, options?: any): Promise<void>;
	closeDiffEditor(originalUri: string, modifiedUri: string): void;
	getDiffEditors(): IServerDiffEditorModel[];
}

export class ServerDiffEditorCommon implements IServerDiffEditorService {
	private readonly _editors = new Set<IServerDiffEditorModel>();

	private readonly _onDidChangeDiffEditors = new Emitter<void>();
	readonly onDidChangeDiffEditors = this._onDidChangeDiffEditors.event;

	async openDiffEditor(originalUri: string, modifiedUri: string, _options?: any): Promise<void> {
		const model = { originalUri, modifiedUri };
		const existing = Array.from(this._editors).find(e => e.originalUri === originalUri && e.modifiedUri === modifiedUri);
		if (!existing) {
			this._editors.add(model);
			this._onDidChangeDiffEditors.fire();
		}
	}

	closeDiffEditor(originalUri: string, modifiedUri: string): void {
		const existing = Array.from(this._editors).find(e => e.originalUri === originalUri && e.modifiedUri === modifiedUri);
		if (existing) {
			this._editors.delete(existing);
			this._onDidChangeDiffEditors.fire();
		}
	}

	getDiffEditors(): IServerDiffEditorModel[] {
		return Array.from(this._editors);
	}
}
