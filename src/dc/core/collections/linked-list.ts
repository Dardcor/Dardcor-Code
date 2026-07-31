/**
 * Dardcor Code - Doubly Linked List
 */

class Node<E> {
	next: Node<E> | undefined = undefined;
	prev: Node<E> | undefined = undefined;
	element: E;

	constructor(element: E) {
		this.element = element;
	}
}

export class LinkedList<E> {
	private _first: Node<E> | undefined = undefined;
	private _last: Node<E> | undefined = undefined;
	private _size = 0;

	get size(): number {
		return this._size;
	}

	isEmpty(): boolean {
		return this._size === 0;
	}

	clear(): void {
		this._first = undefined;
		this._last = undefined;
		this._size = 0;
	}

	unshift(element: E): () => void {
		return this._insert(element, false);
	}

	push(element: E): () => void {
		return this._insert(element, true);
	}

	private _insert(element: E, atTheEnd: boolean): () => void {
		const node = new Node(element);
		if (!this._first) {
			this._first = node;
			this._last = node;
		} else if (atTheEnd) {
			this._last!.next = node;
			node.prev = this._last;
			this._last = node;
		} else {
			this._first.prev = node;
			node.next = this._first;
			this._first = node;
		}
		this._size++;

		let removed = false;
		return () => {
			if (!removed) {
				removed = true;
				this._remove(node);
			}
		};
	}

	shift(): E | undefined {
		if (!this._first) {
			return undefined;
		}
		const res = this._first.element;
		this._remove(this._first);
		return res;
	}

	pop(): E | undefined {
		if (!this._last) {
			return undefined;
		}
		const res = this._last.element;
		this._remove(this._last);
		return res;
	}

	private _remove(node: Node<E>): void {
		if (node.prev) {
			node.prev.next = node.next;
		}
		if (node.next) {
			node.next.prev = node.prev;
		}
		if (node === this._first) {
			this._first = node.next;
		}
		if (node === this._last) {
			this._last = node.prev;
		}
		this._size--;
	}

	*[Symbol.iterator](): Iterator<E> {
		let current = this._first;
		while (current) {
			yield current.element;
			current = current.next;
		}
	}
}
