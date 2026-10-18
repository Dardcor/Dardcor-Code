/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type PrioritizedItem<T> = {
	item: T;
	priority: number;
};

export class PriorityQueue<T> {
	private heap: PrioritizedItem<T>[];

	constructor(items?: PrioritizedItem<T>[]) {
		this.heap = items ? [...items] : [];
		if (this.heap.length > 0) {
			for (let i = Math.floor(this.heap.length / 2) - 1; i >= 0; i--) {
				this.siftDown(i);
			}
		}
	}

	get size(): number {
		return this.heap.length;
	}

	insert(item: T, priority: number): void {
		const newItem: PrioritizedItem<T> = { item, priority };
		this.heap.push(newItem);
		const index = this.heap.length - 1;
		this.siftUp(index);
	}

	peek(): PrioritizedItem<T> | null {
		if (this.heap.length === 0) {
			return null;
		}
		return this.heap[0];
	}

	pop(): PrioritizedItem<T> | null {
		if (this.heap.length === 0) {
			return null;
		}

		const topItem = this.heap[0];
		const lastItem = this.heap.pop()!;

		if (this.heap.length > 0) {
			this.heap[0] = lastItem;
			this.siftDown(0);
		}

		return topItem;
	}

	clear(): PrioritizedItem<T>[] {
		const items = this.heap;
		this.heap = [];
		return items;
	}

	private siftUp(index: number): void {
		const item = this.heap[index];

		while (index > 0) {
			const parentIndex = Math.floor((index - 1) / 2);
			if (this.heap[parentIndex].priority >= item.priority) {
				break;
			}

			this.heap[index] = this.heap[parentIndex];

			index = parentIndex;
		}

		this.heap[index] = item;
	}

	private siftDown(index: number): void {
		while (index < this.size - 1) {
			let maxChildIndex = index;
			const leftChildIndex = 2 * index + 1;
			const rightChildIndex = leftChildIndex + 1;

			if (leftChildIndex < this.size && this.heap[leftChildIndex].priority > this.heap[maxChildIndex].priority) {
				maxChildIndex = leftChildIndex;
			}

			if (
				rightChildIndex < this.size &&
				this.heap[rightChildIndex].priority > this.heap[maxChildIndex].priority
			) {
				maxChildIndex = rightChildIndex;
			}

			if (maxChildIndex === index) {
				break;
			}

			const item = this.heap[index];
			this.heap[index] = this.heap[maxChildIndex];
			this.heap[maxChildIndex] = item;

			index = maxChildIndex;
		}
	}
}
