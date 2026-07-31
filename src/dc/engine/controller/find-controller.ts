/**
 * Dardcor Code - In-Editor Quick Search State Machine (Task 265)
 * Mirrors: vs/editor/contrib/find/browser/findController.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { ITextModel, Position, Range } from '../model/text-model';
import { TextSearch } from '../model/text-search';
import { CursorSelection } from '../cursor/cursor-operations';

export interface IFindState {
	readonly searchString: string;
	readonly replaceString: string;
	readonly isCaseSensitive: boolean;
	readonly isWholeWord: boolean;
	readonly isRegex: boolean;
	readonly isOpen: boolean;
	readonly isReplaceOpen: boolean;
	readonly matchCount: number;
	readonly currentMatchIndex: number;
}

export interface IFindControllerDelegate {
	readonly getModel: () => ITextModel | null;
	readonly getSelection: () => CursorSelection | null;
	readonly setSelection: (selection: CursorSelection) => void;
	readonly revealRange: (range: Range) => void;
	readonly replaceRange: (range: Range, text: string) => void;
}

export class FindController extends Disposable {
	private _searchString = '';
	private _replaceString = '';
	private _isCaseSensitive = false;
	private _isWholeWord = false;
	private _isRegex = false;
	private _isOpen = false;
	private _isReplaceOpen = false;

	private _matches: Range[] = [];
	private _currentIndex = -1;

	private readonly _onDidChangeState = this._register(new Emitter<IFindState>());
	public readonly onDidChangeState: Event<IFindState> = this._onDidChangeState.event;

	constructor(private readonly _delegate: IFindControllerDelegate) {
		super();
	}

	public getState(): IFindState {
		return {
			searchString: this._searchString,
			replaceString: this._replaceString,
			isCaseSensitive: this._isCaseSensitive,
			isWholeWord: this._isWholeWord,
			isRegex: this._isRegex,
			isOpen: this._isOpen,
			isReplaceOpen: this._isReplaceOpen,
			matchCount: this._matches.length,
			currentMatchIndex: this._currentIndex,
		};
	}

	public open(options?: { replace?: boolean }): void {
		this._isOpen = true;
		if (options && options.replace !== undefined) {
			this._isReplaceOpen = options.replace;
		}

		const sel = this._delegate.getSelection();
		const model = this._delegate.getModel();
		if (sel && model && sel.isSelection) {
			const selectedText = this._getValueInRange(model, sel.start, sel.end);
			if (selectedText && !selectedText.includes('\n')) {
				this._searchString = selectedText;
			}
		}

		this._recomputeMatches();
		this._fireStateChange();
	}

	public close(): void {
		if (!this._isOpen) {
			return;
		}
		this._isOpen = false;
		this._isReplaceOpen = false;
		this._matches = [];
		this._currentIndex = -1;
		this._fireStateChange();
	}

	public setSearchString(query: string): void {
		if (this._searchString === query) {
			return;
		}
		this._searchString = query;
		this._recomputeMatches();
		this._fireStateChange();
	}

	public setReplaceString(replacement: string): void {
		if (this._replaceString === replacement) {
			return;
		}
		this._replaceString = replacement;
		this._fireStateChange();
	}

	public setOptions(options: { isCaseSensitive?: boolean; isWholeWord?: boolean; isRegex?: boolean }): void {
		let changed = false;
		if (options.isCaseSensitive !== undefined && this._isCaseSensitive !== options.isCaseSensitive) {
			this._isCaseSensitive = options.isCaseSensitive;
			changed = true;
		}
		if (options.isWholeWord !== undefined && this._isWholeWord !== options.isWholeWord) {
			this._isWholeWord = options.isWholeWord;
			changed = true;
		}
		if (options.isRegex !== undefined && this._isRegex !== options.isRegex) {
			this._isRegex = options.isRegex;
			changed = true;
		}
		if (changed) {
			this._recomputeMatches();
			this._fireStateChange();
		}
	}

	public findNext(): boolean {
		if (this._matches.length === 0) {
			return false;
		}
		this._currentIndex = (this._currentIndex + 1) % this._matches.length;
		const match = this._matches[this._currentIndex];
		this._revealMatch(match);
		this._fireStateChange();
		return true;
	}

	public findPrevious(): boolean {
		if (this._matches.length === 0) {
			return false;
		}
		this._currentIndex = (this._currentIndex - 1 + this._matches.length) % this._matches.length;
		const match = this._matches[this._currentIndex];
		this._revealMatch(match);
		this._fireStateChange();
		return true;
	}

	public replaceCurrent(): boolean {
		if (this._matches.length === 0 || this._currentIndex < 0 || this._currentIndex >= this._matches.length) {
			return false;
		}
		const match = this._matches[this._currentIndex];
		this._delegate.replaceRange(match, this._replaceString);
		this._recomputeMatches();
		this._fireStateChange();
		return true;
	}

	public replaceAll(): number {
		if (this._matches.length === 0) {
			return 0;
		}
		const count = this._matches.length;
		const sorted = [...this._matches].sort((a, b) => b.startLineNumber - a.startLineNumber || b.startColumn - a.startColumn);
		for (const range of sorted) {
			this._delegate.replaceRange(range, this._replaceString);
		}
		this._recomputeMatches();
		this._fireStateChange();
		return count;
	}

	public getMatches(): readonly Range[] {
		return this._matches;
	}

	private _revealMatch(range: Range): void {
		this._delegate.revealRange(range);
		this._delegate.setSelection(
			new CursorSelection(
				new Position(range.startLineNumber, range.startColumn),
				new Position(range.endLineNumber, range.endColumn)
			)
		);
	}

	private _getValueInRange(model: ITextModel, start: Position, end: Position): string {
		if (start.lineNumber === end.lineNumber) {
			return model.getLineContent(start.lineNumber).substring(start.column - 1, end.column - 1);
		}
		const parts: string[] = [model.getLineContent(start.lineNumber).substring(start.column - 1)];
		for (let line = start.lineNumber + 1; line < end.lineNumber; line++) {
			parts.push(model.getLineContent(line));
		}
		parts.push(model.getLineContent(end.lineNumber).substring(0, end.column - 1));
		return parts.join('\n');
	}

	private _recomputeMatches(): void {
		const model = this._delegate.getModel();
		if (!model || !this._searchString) {
			this._matches = [];
			this._currentIndex = -1;
			return;
		}
		try {
			this._matches = TextSearch.findMatchesInModel(model, {
				searchString: this._searchString,
				isRegex: this._isRegex,
				caseSensitive: this._isCaseSensitive,
				wholeWord: this._isWholeWord,
			}).map((match) => match.range);
			if (this._matches.length > 0) {
				this._currentIndex = 0;
			} else {
				this._currentIndex = -1;
			}
		} catch {
			this._matches = [];
			this._currentIndex = -1;
		}
	}

	private _fireStateChange(): void {
		this._onDidChangeState.fire(this.getState());
	}
}
