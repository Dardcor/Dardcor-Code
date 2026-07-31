/**
 * Dardcor Code - Editor Navigation History (Task 169)
 * Mirrors: vs/workbench/services/history/common/history.ts
 */

import { URI } from '../../core/types/uri.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export interface IEditorHistoryItem {
	readonly resource: URI;
	readonly selection?: { startLineNumber: number; startColumn: number };
}

export class EditorHistoryStack {
	private readonly _backStack: IEditorHistoryItem[] = [];
	private readonly _forwardStack: IEditorHistoryItem[] = [];
	private _current: IEditorHistoryItem | null = null;
	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	push(item: IEditorHistoryItem): void {
		if (this._current) {
			this._backStack.push(this._current);
		}
		this._current = item;
		this._forwardStack.length = 0;
		this._onDidChange.fire();
	}

	back(): IEditorHistoryItem | null {
		if (this._backStack.length === 0) return null;
		if (this._current) {
			this._forwardStack.push(this._current);
		}
		this._current = this._backStack.pop()!;
		this._onDidChange.fire();
		return this._current;
	}

	forward(): IEditorHistoryItem | null {
		if (this._forwardStack.length === 0) return null;
		if (this._current) {
			this._backStack.push(this._current);
		}
		this._current = this._forwardStack.pop()!;
		this._onDidChange.fire();
		return this._current;
	}

	get canGoBack(): boolean { return this._backStack.length > 0; }
	get canGoForward(): boolean { return this._forwardStack.length > 0; }
}
