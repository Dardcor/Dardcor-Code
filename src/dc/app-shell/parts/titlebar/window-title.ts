/**
 * Dardcor Code - Dynamic Window Title Generator String
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { EditorPart } from '../editor/editor-part.js';
import { EditorInput } from '../editor/editor-input.js';

export interface IWindowTitleOptions {
	readonly workspaceName?: string;
	readonly productName?: string;
	readonly showUntitledFile?: boolean;
	readonly documentTarget?: Window;
}

export interface IWindowTitleEvent {
	readonly title: string;
	readonly fileName: string | null;
	readonly workspaceName: string | null;
}

export class WindowTitle extends Disposable {
	private readonly _editorPart: EditorPart;
	private _workspaceName: string | null;
	private readonly _productName: string;
	private readonly _showUntitledFile: boolean;
	private readonly _documentTarget: Window;
	private _activeInput: EditorInput | null = null;

	private readonly _onDidChangeTitle = this._register(new Emitter<IWindowTitleEvent>());
	readonly onDidChangeTitle: Event<IWindowTitleEvent> = this._onDidChangeTitle.event;

	constructor(
		editorPart: EditorPart,
		options: IWindowTitleOptions = {}
	) {
		super();
		this._editorPart = editorPart;
		this._workspaceName = options.workspaceName ?? null;
		this._productName = options.productName ?? 'Dardcor Code';
		this._showUntitledFile = options.showUntitledFile ?? true;
		this._documentTarget = options.documentTarget ?? window;

		this._register(this._editorPart.onDidChangeActiveEditor(e => this._onActiveEditorChanged(e?.input ?? null)));
		this._syncActiveInput();
	}

	get title(): string {
		return this.computeTitle(this._activeInput);
	}

	get fileName(): string | null {
		return this._activeInput ? this._fileNameOf(this._activeInput) : null;
	}

	computeTitle(input: EditorInput | null): string {
		const parts: string[] = [];

		const fileName = input ? this._fileNameOf(input) : null;
		if (fileName) {
			parts.push(fileName);
		}

		if (this._workspaceName) {
			parts.push(this._workspaceName);
		}

		parts.push(this._productName);
		return parts.join(' - ');
	}

	setWorkspaceName(workspaceName: string | null): void {
		this._workspaceName = workspaceName;
		this._update();
	}

	update(): void {
		this._update();
	}

	private _fileNameOf(input: EditorInput): string | null {
		if (input.uri.scheme === 'untitled' && !this._showUntitledFile) {
			return null;
		}
		const name = input.getName();
		return name ? name : null;
	}

	private _onActiveEditorChanged(input: EditorInput | null): void {
		if (this._activeInput === input) {
			return;
		}
		this._activeInput = input;
		this._update();
	}

	private _syncActiveInput(): void {
		const group = this._editorPart.activeGroup;
		this._activeInput = group?.activeEditor ?? null;
	}

	private _update(): void {
		const title = this.computeTitle(this._activeInput);
		this._documentTarget.document.title = title;
		this._onDidChangeTitle.fire({
			title,
			fileName: this.fileName,
			workspaceName: this._workspaceName,
		});
	}

	dispose(): void {
		super.dispose();
	}
}
