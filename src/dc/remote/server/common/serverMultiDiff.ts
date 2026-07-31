import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerMultiDiffEntry {
	readonly originalUri: string;
	readonly modifiedUri: string;
	readonly label?: string;
}

export interface IServerMultiDiffEditorService {
	readonly onDidOpenMultiDiffEditor: Event<{ id: string; entries: IServerMultiDiffEntry[] }>;
	readonly onDidCloseMultiDiffEditor: Event<string>;
	openMultiDiffEditor(id: string, entries: IServerMultiDiffEntry[], title?: string): void;
	closeMultiDiffEditor(id: string): void;
	getEntries(id: string): IServerMultiDiffEntry[];
	isMultiDiffEditorOpen(id: string): boolean;
	addEntry(id: string, entry: IServerMultiDiffEntry): void;
	removeEntry(id: string, originalUri: string): void;
}

export class ServerMultiDiffCommon implements IServerMultiDiffEditorService {
	private readonly _editors = new Map<string, IServerMultiDiffEntry[]>();

	private readonly _onDidOpenMultiDiffEditor = new Emitter<{ id: string; entries: IServerMultiDiffEntry[] }>();
	readonly onDidOpenMultiDiffEditor = this._onDidOpenMultiDiffEditor.event;

	private readonly _onDidCloseMultiDiffEditor = new Emitter<string>();
	readonly onDidCloseMultiDiffEditor = this._onDidCloseMultiDiffEditor.event;

	openMultiDiffEditor(id: string, entries: IServerMultiDiffEntry[], _title?: string): void {
		this._editors.set(id, [...entries]);
		this._onDidOpenMultiDiffEditor.fire({ id, entries });
	}

	closeMultiDiffEditor(id: string): void {
		this._editors.delete(id);
		this._onDidCloseMultiDiffEditor.fire(id);
	}

	getEntries(id: string): IServerMultiDiffEntry[] {
		return this._editors.get(id) || [];
	}

	isMultiDiffEditorOpen(id: string): boolean {
		return this._editors.has(id);
	}

	addEntry(id: string, entry: IServerMultiDiffEntry): void {
		const entries = this._editors.get(id);
		if (entries) { entries.push(entry); }
	}

	removeEntry(id: string, originalUri: string): void {
		const entries = this._editors.get(id);
		if (entries) {
			const idx = entries.findIndex(e => e.originalUri === originalUri);
			if (idx >= 0) { entries.splice(idx, 1); }
		}
	}
}
