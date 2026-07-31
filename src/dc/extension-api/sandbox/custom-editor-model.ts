import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface ICustomEditorEdit {
	start: number;
	end: number;
	text: string;
}

export class CustomEditorModel extends Disposable {
	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	private _content: string;
	private readonly _undoStack: ICustomEditorEdit[] = [];
	private readonly _redoStack: ICustomEditorEdit[] = [];
	private _dirty = false;

	constructor(initialContent = '') {
		super();
		this._content = initialContent;
	}

	public getContent(): string {
		return this._content;
	}

	public get isDirty(): boolean {
		return this._dirty;
	}

	public applyEdit(edit: ICustomEditorEdit): void {
		const oldText = this._content.substring(edit.start, edit.end);
		this._content = this._content.substring(0, edit.start) + edit.text + this._content.substring(edit.end);
		this._undoStack.push({ start: edit.start, end: edit.start + edit.text.length, text: oldText });
		this._redoStack.length = 0;
		this._dirty = true;
		this._onDidChangeContent.fire();
	}

	public undo(): void {
		const inverse = this._undoStack.pop();
		if (!inverse) {
			return;
		}
		const oldText = this._content.substring(inverse.start, inverse.end);
		this._content = this._content.substring(0, inverse.start) + inverse.text + this._content.substring(inverse.end);
		this._redoStack.push({ start: inverse.start, end: inverse.start + inverse.text.length, text: oldText });
		this._dirty = true;
		this._onDidChangeContent.fire();
	}

	public redo(): void {
		const inverse = this._redoStack.pop();
		if (!inverse) {
			return;
		}
		const oldText = this._content.substring(inverse.start, inverse.end);
		this._content = this._content.substring(0, inverse.start) + inverse.text + this._content.substring(inverse.end);
		this._undoStack.push({ start: inverse.start, end: inverse.start + inverse.text.length, text: oldText });
		this._dirty = true;
		this._onDidChangeContent.fire();
	}

	public markDirty(): void {
		this._dirty = true;
	}

	public save(content: string): void {
		this._content = content;
		this._dirty = false;
		this._onDidChangeContent.fire();
	}
}
