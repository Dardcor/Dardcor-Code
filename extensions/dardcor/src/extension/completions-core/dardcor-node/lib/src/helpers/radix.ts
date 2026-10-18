/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class LRURadixTrie<T> {
	private readonly root = new LRURadixNode<T>();

	private readonly leafNodes: Set<LRURadixNode<T>> = new Set();

	constructor(private readonly maxSize: number) { }

	set(key: string, value: T): void {
		let { node, remainingKey } = this.findClosestNode(key);
		if (remainingKey.length > 0) {
			for (const [edge, child] of node.children) {
				if (edge.startsWith(remainingKey)) {
					const commonPrefix = edge.slice(0, remainingKey.length);
					const intermediate = new LRURadixNode<T>();
					node.removeChild(edge);
					node.addChild(commonPrefix, intermediate);
					intermediate.addChild(edge.slice(commonPrefix.length), child);
					node = intermediate;
					remainingKey = remainingKey.slice(commonPrefix.length);
					break;
				}
			}
			if (remainingKey.length > 0) {
				const newNode = new LRURadixNode<T>();
				node.addChild(remainingKey, newNode);
				node = newNode;
			}
		}
		node.value = value;
		this.leafNodes.add(node);
		if (this.leafNodes.size > this.maxSize) {
			this.evictLeastRecentlyUsed();
		}
	}

	findAll(key: string): Array<{ remainingKey: string; value: T }> {
		return this.findClosestNode(key)
			.stack.map(({ node, remainingKey }) =>
				node.value !== undefined ? { remainingKey, value: node.value } : undefined
			)
			.filter(x => x !== undefined);
	}

	delete(key: string): void {
		const { node, remainingKey } = this.findClosestNode(key);
		if (remainingKey.length > 0) { return; }
		this.deleteNode(node);
	}

	private findClosestNode(key: string) {
		let hasNext = true;
		let node: LRURadixNode<T> = this.root;
		const stack: { node: LRURadixNode<T>; remainingKey: string }[] = [{ node, remainingKey: key }];
		while (key.length > 0 && hasNext) {
			hasNext = false;
			for (const [edge, child] of node.children) {
				if (key.startsWith(edge)) {
					key = key.slice(edge.length);
					stack.unshift({ node: child, remainingKey: key });
					node = child;
					hasNext = true;
					break;
				}
			}
		}
		return { node, remainingKey: key, stack };
	}

	private deleteNode(node: LRURadixNode<T>): void {
		node.value = undefined;
		this.leafNodes.delete(node);
		if (node.parent === undefined) { return; }
		if (node.childCount > 1) { return; }
		const { node: parent, edge } = node.parent;
		if (node.childCount === 1) {
			const [childEdge, childNode] = Array.from(node.children)[0];
			node.removeChild(childEdge);
			parent.removeChild(edge);
			parent.addChild(edge + childEdge, childNode);
			return;
		}
		parent.removeChild(edge);
		if (parent.parent === undefined) { return; }
		const grandparent = parent.parent;
		if (parent.value === undefined && parent.childCount === 1) {
			const [childEdge, childNode] = Array.from(parent.children)[0];
			const newEdge = grandparent.edge + childEdge;
			parent.removeChild(childEdge);
			grandparent.node.removeChild(grandparent.edge);
			grandparent.node.addChild(newEdge, childNode);
		}
	}

	private evictLeastRecentlyUsed(): void {
		const node = this.findLeastRecentlyUsed();
		if (node) { this.deleteNode(node); }
	}

	private findLeastRecentlyUsed(): LRURadixNode<T> | undefined {
		let least: LRURadixNode<T> | undefined;
		for (const node of this.leafNodes) {
			if (least === undefined || node.touched < least.touched) {
				least = node;
			}
		}
		return least;
	}
}

class LRURadixNode<T> {
	private readonly _children: Map<string, LRURadixNode<T>> = new Map();
	private _touched = performance.now();
	private _value: T | undefined;

	parent: { node: LRURadixNode<T>; edge: string } | undefined;

	get children() {
		return this._children.entries();
	}

	get childCount() {
		return this._children.size;
	}

	addChild(edge: string, child: LRURadixNode<T>): void {
		this._children.set(edge, child);
		child.parent = { node: this, edge };
	}

	removeChild(edge: string): void {
		const child = this._children.get(edge);
		if (child) { child.parent = undefined; }
		this._children.delete(edge);
	}

	get value(): T | undefined {
		this.touch();
		return this._value;
	}

	set value(value: T | undefined) {
		this.touch();
		this._value = value;
	}

	get touched(): number {
		return this._touched;
	}

	private touch(): void {
		this._touched = performance.now();
	}
}
