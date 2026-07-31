import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerCommentEditor {
	readonly id: string;
	readonly threadId: string;
	readonly content: string;
	readonly isDirty: boolean;
}

export interface IServerCommentsEditorService {
	readonly onDidChangeCommentEditor: Event<IServerCommentEditor>;
	openCommentEditor(threadId: string): Promise<IServerCommentEditor>;
	closeCommentEditor(id: string): void;
	getCommentEditor(id: string): IServerCommentEditor | undefined;
	saveComment(id: string, content: string): Promise<void>;
}

export class ServerCommentsEditorCommon implements IServerCommentsEditorService {
	private readonly _editors = new Map<string, IServerCommentEditor>();
	private _nextId = 1;

	private readonly _onDidChangeCommentEditor = new Emitter<IServerCommentEditor>();
	readonly onDidChangeCommentEditor = this._onDidChangeCommentEditor.event;

	async openCommentEditor(threadId: string): Promise<IServerCommentEditor> {
		const existing = Array.from(this._editors.values()).find(e => e.threadId === threadId);
		if (existing) return existing;

		const id = `comment-editor-${this._nextId++}`;
		const editor: IServerCommentEditor = { id, threadId, content: '', isDirty: false };
		this._editors.set(id, editor);
		return editor;
	}

	closeCommentEditor(id: string): void {
		this._editors.delete(id);
	}

	getCommentEditor(id: string): IServerCommentEditor | undefined {
		return this._editors.get(id);
	}

	async saveComment(id: string, content: string): Promise<void> {
		const editor = this._editors.get(id);
		if (editor) {
			const updated = { ...editor, content, isDirty: false };
			this._editors.set(id, updated);
			this._onDidChangeCommentEditor.fire(updated);
		}
	}
}
