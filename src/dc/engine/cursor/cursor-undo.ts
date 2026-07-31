import { Selection } from '../model/selection.js';

export class CursorUndo {
	private readonly _past: Selection[][] = [];
	private readonly _future: Selection[][] = [];
	private _limit: number;

	constructor(limit: number = 100) {
		this._limit = Math.max(1, limit);
	}

	public push(selections: Selection[]): void {
		const snapshot = selections.map(selection => selection.clone());
		const top = this._past[this._past.length - 1];
		if (top && CursorUndo._same(top, snapshot)) {
			return;
		}
		this._past.push(snapshot);
		if (this._past.length > this._limit) {
			this._past.shift();
		}
		this._future.length = 0;
	}

	public undo(): Selection[] | undefined {
		if (this._past.length === 0) {
			return undefined;
		}
		const snapshot = this._past.pop() as Selection[];
		this._future.push(snapshot);
		if (this._future.length > this._limit) {
			this._future.shift();
		}
		return snapshot;
	}

	public redo(): Selection[] | undefined {
		if (this._future.length === 0) {
			return undefined;
		}
		const snapshot = this._future.pop() as Selection[];
		this._past.push(snapshot);
		if (this._past.length > this._limit) {
			this._past.shift();
		}
		return snapshot;
	}

	public clear(): void {
		this._past.length = 0;
		this._future.length = 0;
	}

	public canUndo(): boolean {
		return this._past.length > 0;
	}

	public canRedo(): boolean {
		return this._future.length > 0;
	}

	public getUndoCount(): number {
		return this._past.length;
	}

	public getRedoCount(): number {
		return this._future.length;
	}

	public getLimit(): number {
		return this._limit;
	}

	public setLimit(limit: number): void {
		this._limit = Math.max(1, limit);
		while (this._past.length > this._limit) {
			this._past.shift();
		}
		while (this._future.length > this._limit) {
			this._future.shift();
		}
	}

	public peekUndo(): Selection[] | undefined {
		if (this._past.length === 0) {
			return undefined;
		}
		return this._past[this._past.length - 1];
	}

	public peekRedo(): Selection[] | undefined {
		if (this._future.length === 0) {
			return undefined;
		}
		return this._future[this._future.length - 1];
	}

	private static _same(a: Selection[], b: Selection[]): boolean {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i++) {
			if (!a[i].equals(b[i])) {
				return false;
			}
		}
		return true;
	}
}
