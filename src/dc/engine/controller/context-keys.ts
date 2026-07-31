/**
 * Dardcor Code - Editor Focus/Selection Context Key Updater (Task 258)
 * Mirrors: vs/editor/common/editorContextKeys.ts + vs/editor/browser/controller/editorController.ts
 */

import { IContextKey, IContextKeyService } from '../../services/contextkey/contextkey-service.js';
import { Disposable } from '../../core/lifecycle/disposable.js';
import { Position } from '../model/text-model.js';

export interface IEditorContextState {
	readonly focused: boolean;
	readonly hasSelection: boolean;
	readonly cursorLineNumber: number;
	readonly cursorColumn: number;
	readonly totalLines: number;
	readonly isAtLineStart: boolean;
	readonly isAtLineEnd: boolean;
	readonly isReadonly: boolean;
}

export class EditorContextKeys extends Disposable {
	private readonly _focused: IContextKey<boolean>;
	private readonly _hasSelection: IContextKey<boolean>;
	private readonly _cursorAtLineStart: IContextKey<boolean>;
	private readonly _cursorAtLineEnd: IContextKey<boolean>;
	private readonly _isReadonly: IContextKey<boolean>;
	private readonly _hasMultipleSelections: IContextKey<boolean>;
	private readonly _totalLines: IContextKey<number>;
	private readonly _cursorLineNumber: IContextKey<number>;

	constructor(
		contextKeyService: IContextKeyService,
		private readonly _getState: () => IEditorContextState
	) {
		super();
		this._focused = this._registerKey(contextKeyService, 'editorFocused', false);
		this._hasSelection = this._registerKey(contextKeyService, 'editorHasSelection', false);
		this._cursorAtLineStart = this._registerKey(contextKeyService, 'editorCursorAtLineStart', false);
		this._cursorAtLineEnd = this._registerKey(contextKeyService, 'editorCursorAtLineEnd', false);
		this._isReadonly = this._registerKey(contextKeyService, 'editorIsReadonly', false);
		this._hasMultipleSelections = this._registerKey(contextKeyService, 'editorHasMultipleSelections', false);
		this._totalLines = this._registerKey(contextKeyService, 'editorTotalLines', 1);
		this._cursorLineNumber = this._registerKey(contextKeyService, 'editorCursorLineNumber', 1);
	}

	public update(): void {
		const state = this._getState();
		this._focused.set(state.focused);
		this._hasSelection.set(state.hasSelection);
		this._cursorAtLineStart.set(state.isAtLineStart);
		this._cursorAtLineEnd.set(state.isAtLineEnd);
		this._isReadonly.set(state.isReadonly);
		this._totalLines.set(state.totalLines);
		this._cursorLineNumber.set(state.cursorLineNumber);
		this._hasMultipleSelections.set(false);
	}

	public static createState(
		focused: boolean,
		cursorPosition: Position | null,
		selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null,
		totalLines: number,
		isReadonly = false
	): IEditorContextState {
		const hasSelection = !!selection
			&& (selection.startLineNumber !== selection.endLineNumber || selection.startColumn !== selection.endColumn);
		return {
			focused,
			hasSelection,
			cursorLineNumber: cursorPosition ? cursorPosition.lineNumber : 1,
			cursorColumn: cursorPosition ? cursorPosition.column : 1,
			totalLines: Math.max(1, totalLines),
			isAtLineStart: cursorPosition ? cursorPosition.column <= 1 : true,
			isAtLineEnd: cursorPosition ? cursorPosition.column >= Number.MAX_SAFE_INTEGER : false,
			isReadonly,
		};
	}

	private _registerKey<T>(service: IContextKeyService, key: string, defaultValue: T): IContextKey<T> {
		return this._register(new ContextKeyDisposable(service.createKey(key, defaultValue)));
	}

	public override dispose(): void {
		super.dispose();
	}
}

class ContextKeyDisposable<T> implements IContextKey<T> {
	private readonly _key: IContextKey<T>;

	constructor(key: IContextKey<T>) {
		this._key = key;
	}

	public set(value: T): void {
		this._key.set(value);
	}

	public reset(): void {
		this._key.reset();
	}

	public get(): T | undefined {
		return this._key.get();
	}

	public dispose(): void {
		this.reset();
	}
}
