export interface IHistory<T> {
	add(item: T): void;
	next(): T | null;
	previous(): T | null;
	current(): T | null;
	has(item: T): boolean;
	clear(): void;
}

export class HistoryNavigator<T> implements IHistory<T> {
	private _history: T[] = [];
	private _index = -1;

	constructor(history: T[] = [], private limit: number = 100) {
		this._history = [...history];
		this._index = this._history.length;
	}

	public add(item: T): void {
		const index = this._history.indexOf(item);
		if (index !== -1) {
			this._history.splice(index, 1);
		}
		this._history.push(item);
		if (this._history.length > this.limit) {
			this._history.shift();
		}
		this._index = this._history.length;
	}

	public next(): T | null {
		if (this._index < this._history.length) {
			this._index++;
		}
		return this.current();
	}

	public previous(): T | null {
		if (this._index > 0) {
			this._index--;
		}
		return this.current();
	}

	public current(): T | null {
		if (this._index >= 0 && this._index < this._history.length) {
			return this._history[this._index];
		}
		return null;
	}

	public has(item: T): boolean {
		return this._history.includes(item);
	}

	public clear(): void {
		this._history = [];
		this._index = -1;
	}
}
