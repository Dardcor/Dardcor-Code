/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Iterable } from './iterator.js';

const unset = Symbol('unset');

export interface IPrefixTreeNode<T> {
	children?: ReadonlyMap<string, Node<T>>;

	value: T | undefined;
}

export class WellDefinedPrefixTree<V> {
	public readonly root = new Node<V>();
	private _size = 0;

	public get size() {
		return this._size;
	}

	public get nodes(): Iterable<IPrefixTreeNode<V>> {
		return this.root.children?.values() || Iterable.empty();
	}

	public get entries(): Iterable<[string, IPrefixTreeNode<V>]> {
		return this.root.children?.entries() || Iterable.empty();
	}

	insert(key: Iterable<string>, value: V, onNode?: (n: IPrefixTreeNode<V>) => void): void {
		this.opNode(key, n => n._value = value, onNode);
	}

	mutate(key: Iterable<string>, mutate: (value?: V) => V): void {
		this.opNode(key, n => n._value = mutate(n._value === unset ? undefined : n._value));
	}

	mutatePath(key: Iterable<string>, mutate: (node: IPrefixTreeNode<V>) => void): void {
		this.opNode(key, () => { }, n => mutate(n));
	}

	delete(key: Iterable<string>): V | undefined {
		const path = this.getPathToKey(key);
		if (!path) {
			return;
		}

		let i = path.length - 1;
		const value = path[i].node._value;
		if (value === unset) {
			return;
		}

		this._size--;
		path[i].node._value = unset;

		for (; i > 0; i--) {
			const { node, part } = path[i];
			if (node.children?.size || node._value !== unset) {
				break;
			}

			path[i - 1].node.children!.delete(part);
		}

		return value;
	}

	*deleteRecursive(key: Iterable<string>): Iterable<V> {
		const path = this.getPathToKey(key);
		if (!path) {
			return;
		}

		const subtree = path[path.length - 1].node;

		for (let i = path.length - 1; i > 0; i--) {
			const parent = path[i - 1];
			parent.node.children!.delete(path[i].part);
			if (parent.node.children!.size > 0 || parent.node._value !== unset) {
				break;
			}
		}

		for (const node of bfsIterate(subtree)) {
			if (node._value !== unset) {
				this._size--;
				yield node._value;
			}
		}

		if (subtree === this.root) {
			this.root._value = unset;
			this.root.children = undefined;
		}
	}

	find(key: Iterable<string>): V | undefined {
		let node = this.root;
		for (const segment of key) {
			const next = node.children?.get(segment);
			if (!next) {
				return undefined;
			}

			node = next;
		}

		return node._value === unset ? undefined : node._value;
	}

	hasKeyOrParent(key: Iterable<string>): boolean {
		let node = this.root;
		for (const segment of key) {
			const next = node.children?.get(segment);
			if (!next) {
				return false;
			}
			if (next._value !== unset) {
				return true;
			}

			node = next;
		}

		return false;
	}

	hasKeyOrChildren(key: Iterable<string>): boolean {
		let node = this.root;
		for (const segment of key) {
			const next = node.children?.get(segment);
			if (!next) {
				return false;
			}

			node = next;
		}

		return true;
	}

	hasKey(key: Iterable<string>): boolean {
		let node = this.root;
		for (const segment of key) {
			const next = node.children?.get(segment);
			if (!next) {
				return false;
			}

			node = next;
		}

		return node._value !== unset;
	}

	private getPathToKey(key: Iterable<string>) {
		const path = [{ part: '', node: this.root }];
		let i = 0;
		for (const part of key) {
			const node = path[i].node.children?.get(part);
			if (!node) {
				return;
			}

			path.push({ part, node });
			i++;
		}

		return path;
	}

	private opNode(key: Iterable<string>, fn: (node: Node<V>) => void, onDescend?: (node: Node<V>) => void): void {
		let node = this.root;
		for (const part of key) {
			if (!node.children) {
				const next = new Node<V>();
				node.children = new Map([[part, next]]);
				node = next;
			} else if (!node.children.has(part)) {
				const next = new Node<V>();
				node.children.set(part, next);
				node = next;
			} else {
				node = node.children.get(part)!;
			}
			onDescend?.(node);
		}

		const sizeBefore = node._value === unset ? 0 : 1;
		fn(node);
		const sizeAfter = node._value === unset ? 0 : 1;
		this._size += sizeAfter - sizeBefore;
	}

	*values() {
		for (const { _value } of bfsIterate(this.root)) {
			if (_value !== unset) {
				yield _value;
			}
		}
	}
}

function* bfsIterate<T>(root: Node<T>): Iterable<Node<T>> {
	const stack = [root];
	while (stack.length > 0) {
		const node = stack.pop()!;
		yield node;

		if (node.children) {
			for (const child of node.children.values()) {
				stack.push(child);
			}
		}
	}
}

class Node<T> implements IPrefixTreeNode<T> {
	public children?: Map<string, Node<T>>;

	public get value() {
		return this._value === unset ? undefined : this._value;
	}

	public set value(value: T | undefined) {
		this._value = value === undefined ? unset : value;
	}

	public _value: T | typeof unset = unset;
}
