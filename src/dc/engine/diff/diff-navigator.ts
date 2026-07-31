/**
 * Dardcor Code - Change-to-Change Jump Controller (Task 254)
 * Mirrors: vs/editor/contrib/diffEditor/browser/diffNavigator.ts
 */

import { Emitter, Event } from '../../core/events/emitter';
import { Disposable } from '../../core/lifecycle/disposable';
import { DiffChange } from './diff-change';
import { IRange } from '../model/text-model';

export interface IDiffNavigatorCallbacks {
	getChanges(): DiffChange[];
	getModifiedRange(change: DiffChange): IRange;
	revealRange(range: IRange): void;
	setSelection(range: IRange): void;
}

export interface IDiffNavigatorState {
	readonly currentIndex: number;
	readonly changeCount: number;
}

export class DiffNavigator extends Disposable {
	private _index = -1;
	private readonly _seenChanges = new Set<string>();

	private readonly _onDidChangeCurrent = this._register(new Emitter<IDiffNavigatorState>());
	readonly onDidChangeCurrent: Event<IDiffNavigatorState> = this._onDidChangeCurrent.event;

	constructor(private readonly _callbacks: IDiffNavigatorCallbacks) {
		super();
	}

	public next(): DiffChange | null {
		const changes = this._getChanges();
		if (changes.length === 0) {
			return null;
		}
		this._index = (this._index + 1) % changes.length;
		return this._revealCurrent();
	}

	public previous(): DiffChange | null {
		const changes = this._getChanges();
		if (changes.length === 0) {
			return null;
		}
		this._index = (this._index - 1 + changes.length) % changes.length;
		return this._revealCurrent();
	}

	public nextUnseen(): DiffChange | null {
		const changes = this._getChanges();
		for (let offset = 1; offset <= changes.length; offset++) {
			const index = (this._index + offset) % changes.length;
			const key = this._getKey(changes[index]);
			if (!this._seenChanges.has(key)) {
				this._seenChanges.add(key);
				this._index = index;
				return this._revealCurrent();
			}
		}
		return null;
	}

	public getCurrentChange(): DiffChange | null {
		const changes = this._getChanges();
		if (this._index < 0 || this._index >= changes.length) {
			return null;
		}
		return changes[this._index];
	}

	public hasNext(): boolean {
		return this._getChanges().length > 0;
	}

	public hasPrevious(): boolean {
		return this._getChanges().length > 0;
	}

	public getChangeCount(): number {
		return this._getChanges().length;
	}

	public getCurrentIndex(): number {
		return this._index;
	}

	public setCurrentIndex(index: number): void {
		const changes = this._getChanges();
		if (changes.length === 0) {
			this._index = -1;
			return;
		}
		this._index = Math.max(0, Math.min(changes.length - 1, index));
		this._revealCurrent();
	}

	public reset(): void {
		this._index = -1;
		this._seenChanges.clear();
	}

	public jumpToChange(change: DiffChange): void {
		const changes = this._getChanges();
		const index = changes.indexOf(change);
		if (index === -1) {
			return;
		}
		this._index = index;
		this._revealCurrent();
	}

	private _getChanges(): DiffChange[] {
		return this._callbacks.getChanges();
	}

	private _revealCurrent(): DiffChange | null {
		const change = this.getCurrentChange();
		if (!change) {
			return null;
		}
		const range = this._callbacks.getModifiedRange(change);
		this._callbacks.revealRange(range);
		this._callbacks.setSelection(range);
		this._onDidChangeCurrent.fire({ currentIndex: this._index, changeCount: this.getChangeCount() });
		return change;
	}

	private _getKey(change: DiffChange): string {
		return `${change.originalStartLineNumber}:${change.originalEndLineNumberExclusive}:${change.modifiedStartLineNumber}:${change.modifiedEndLineNumberExclusive}`;
	}

	public getState(): IDiffNavigatorState {
		return { currentIndex: this._index, changeCount: this.getChangeCount() };
	}
}
