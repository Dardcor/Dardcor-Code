/**
 * Dardcor Code - Ring Buffer (Task 78)
 * Mirrors: vs/base/common/history.ts
 */

export class RingBuffer<T> {
	private readonly _buffer: (T | undefined)[];
	private _head = 0;
	private _size = 0;

	constructor(readonly capacity: number) {
		this._buffer = new Array(capacity);
	}

	get size(): number {
		return this._size;
	}

	get isFull(): boolean {
		return this._size === this.capacity;
	}

	push(value: T): void {
		this._buffer[this._head] = value;
		this._head = (this._head + 1) % this.capacity;
		if (this._size < this.capacity) {
			this._size++;
		}
	}

	get(index: number): T | undefined {
		if (index < 0 || index >= this._size) return undefined;
		const actualIndex = (this._head - this._size + index + this.capacity) % this.capacity;
		return this._buffer[actualIndex];
	}

	last(): T | undefined {
		if (this._size === 0) return undefined;
		return this._buffer[(this._head - 1 + this.capacity) % this.capacity];
	}

	first(): T | undefined {
		if (this._size === 0) return undefined;
		return this._buffer[(this._head - this._size + this.capacity) % this.capacity];
	}

	toArray(): T[] {
		const result: T[] = [];
		for (let i = 0; i < this._size; i++) {
			result.push(this.get(i)!);
		}
		return result;
	}

	clear(): void {
		this._buffer.fill(undefined);
		this._head = 0;
		this._size = 0;
	}

	*[Symbol.iterator](): Iterator<T> {
		for (let i = 0; i < this._size; i++) {
			yield this.get(i)!;
		}
	}
}

export class HistoryNavigator<T> {
	private readonly _history: T[] = [];
	private _cursor = -1;
	private readonly _limit: number;

	constructor(limit: number = 100) {
		this._limit = limit;
	}

	add(value: T): void {
		// Remove forward history
		this._history.splice(this._cursor + 1);
		this._history.push(value);
		if (this._history.length > this._limit) {
			this._history.shift();
		}
		this._cursor = this._history.length - 1;
	}

	current(): T | undefined {
		return this._cursor >= 0 ? this._history[this._cursor] : undefined;
	}

	previous(): T | undefined {
		if (this._cursor > 0) {
			this._cursor--;
			return this._history[this._cursor];
		}
		return this._cursor === 0 ? this._history[0] : undefined;
	}

	next(): T | undefined {
		if (this._cursor < this._history.length - 1) {
			this._cursor++;
			return this._history[this._cursor];
		}
		return undefined;
	}

	has(value: T): boolean {
		return this._history.includes(value);
	}

	clear(): void {
		this._history.length = 0;
		this._cursor = -1;
	}

	getHistory(): readonly T[] {
		return this._history;
	}
}
