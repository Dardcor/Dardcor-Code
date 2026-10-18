/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ITextModel } from '../../../model.js';

export class ListNode implements IDisposable {
	parent?: ListNode;
	private readonly _children: Node[] = [];
	get children(): ReadonlyArray<Node> { return this._children; }

	private _length: number = 0;
	get length(): number { return this._length; }

	constructor(public readonly height: number) { }

	static create(node1: Node, node2: Node) {
		const list = new ListNode(node1.height + 1);
		list.appendChild(node1);
		list.appendChild(node2);
		return list;
	}

	canAppendChild(): boolean {
		return this._children.length < 3;
	}

	appendChild(node: Node) {
		if (!this.canAppendChild()) {
			throw new Error('Cannot insert more than 3 children in a ListNode');
		}
		this._children.push(node);

		this._length += node.length;
		this._updateParentLength(node.length);
		if (!isLeaf(node)) {
			node.parent = this;
		}
	}

	private _updateParentLength(delta: number) {
		let updateParent = this.parent;
		while (updateParent) {
			updateParent._length += delta;
			updateParent = updateParent.parent;
		}
	}

	unappendChild(): Node {
		const child = this._children.pop()!;
		this._length -= child.length;
		this._updateParentLength(-child.length);
		return child;
	}

	prependChild(node: Node) {
		if (this._children.length >= 3) {
			throw new Error('Cannot prepend more than 3 children in a ListNode');
		}
		this._children.unshift(node);

		this._length += node.length;
		this._updateParentLength(node.length);
		if (!isLeaf(node)) {
			node.parent = this;
		}
	}

	unprependChild(): Node {
		const child = this._children.shift()!;
		this._length -= child.length;
		this._updateParentLength(-child.length);
		return child;
	}

	lastChild(): Node {
		return this._children[this._children.length - 1];
	}

	dispose() {
		this._children.splice(0, this._children.length);
	}
}

export enum TokenQuality {
	None = 0,
	ViewportGuess = 1,
	EditGuess = 2,
	Accurate = 3
}

type Node = ListNode | LeafNode;

export interface LeafNode {
	readonly length: number;
	token: number;
	tokenQuality: TokenQuality;
	height: 0;
}

export interface TokenUpdate {
	readonly startOffsetInclusive: number;
	readonly length: number;
	readonly token: number;
}

function isLeaf(node: Node): node is LeafNode {
	return (node as LeafNode).token !== undefined;
}

function append(node: Node, nodeToAppend: Node): Node {
	let curNode = node;
	const parents: ListNode[] = [];
	let nodeToAppendOfCorrectHeight: Node | undefined;
	while (true) {
		if (nodeToAppend.height === curNode.height) {
			nodeToAppendOfCorrectHeight = nodeToAppend;
			break;
		}

		if (isLeaf(curNode)) {
			throw new Error('unexpected');
		}
		parents.push(curNode);
		curNode = curNode.lastChild();
	}
	for (let i = parents.length - 1; i >= 0; i--) {
		const parent = parents[i];
		if (nodeToAppendOfCorrectHeight) {
			if (parent.children.length >= 3) {
				const newList = ListNode.create(parent.unappendChild(), nodeToAppendOfCorrectHeight);
				nodeToAppendOfCorrectHeight = newList;
			} else {
				parent.appendChild(nodeToAppendOfCorrectHeight);
				nodeToAppendOfCorrectHeight = undefined;
			}
		}
	}
	if (nodeToAppendOfCorrectHeight) {
		const newList = new ListNode(nodeToAppendOfCorrectHeight.height + 1);
		newList.appendChild(node);
		newList.appendChild(nodeToAppendOfCorrectHeight);
		return newList;
	} else {
		return node;
	}
}

function prepend(list: Node, nodeToAppend: Node): Node {
	let curNode = list;
	const parents: ListNode[] = [];
	while (nodeToAppend.height !== curNode.height) {
		if (isLeaf(curNode)) {
			throw new Error('unexpected');
		}
		parents.push(curNode);
		curNode = curNode.children[0] as ListNode;
	}
	let nodeToPrependOfCorrectHeight: Node | undefined = nodeToAppend;
	for (let i = parents.length - 1; i >= 0; i--) {
		const parent = parents[i];
		if (nodeToPrependOfCorrectHeight) {
			if (parent.children.length >= 3) {
				nodeToPrependOfCorrectHeight = ListNode.create(nodeToPrependOfCorrectHeight, parent.unprependChild());
			} else {
				parent.prependChild(nodeToPrependOfCorrectHeight);
				nodeToPrependOfCorrectHeight = undefined;
			}
		}
	}
	if (nodeToPrependOfCorrectHeight) {
		return ListNode.create(nodeToPrependOfCorrectHeight, list);
	} else {
		return list;
	}
}

function concat(node1: Node, node2: Node): Node {
	if (node1.height === node2.height) {
		return ListNode.create(node1, node2);
	}
	else if (node1.height > node2.height) {
		return append(node1, node2);
	} else {
		return prepend(node2, node1);
	}
}

export class TokenStore implements IDisposable {
	private _root: Node;
	get root(): Node {
		return this._root;
	}

	constructor(private readonly _textModel: ITextModel) {
		this._root = this.createEmptyRoot();
	}

	private createEmptyRoot(): Node {
		return {
			length: this._textModel.getValueLength(),
			token: 0,
			height: 0,
			tokenQuality: TokenQuality.None
		};
	}

	buildStore(tokens: TokenUpdate[], tokenQuality: TokenQuality): void {
		this._root = this.createFromUpdates(tokens, tokenQuality);
	}

	private createFromUpdates(tokens: TokenUpdate[], tokenQuality: TokenQuality): Node {
		if (tokens.length === 0) {
			return this.createEmptyRoot();
		}
		let newRoot: Node = {
			length: tokens[0].length,
			token: tokens[0].token,
			height: 0,
			tokenQuality
		};
		for (let j = 1; j < tokens.length; j++) {
			newRoot = append(newRoot, { length: tokens[j].length, token: tokens[j].token, height: 0, tokenQuality });
		}
		return newRoot;
	}

	update(length: number, tokens: TokenUpdate[], tokenQuality: TokenQuality) {
		if (tokens.length === 0) {
			return;
		}
		this.replace(length, tokens[0].startOffsetInclusive, tokens, tokenQuality);
	}

	delete(length: number, startOffset: number) {
		this.replace(length, startOffset, [], TokenQuality.EditGuess);
	}

	private replace(length: number, updateOffsetStart: number, tokens: TokenUpdate[], tokenQuality: TokenQuality) {
		const firstUnchangedOffsetAfterUpdate = updateOffsetStart + length;
		const precedingNodes: Node[] = [];
		const postcedingNodes: Node[] = [];
		const stack: { node: Node; offset: number }[] = [{ node: this._root, offset: 0 }];

		while (stack.length > 0) {
			const node = stack.pop()!;
			const currentOffset = node.offset;

			if (currentOffset < updateOffsetStart && currentOffset + node.node.length <= updateOffsetStart) {
				if (!isLeaf(node.node)) {
					node.node.parent = undefined;
				}
				precedingNodes.push(node.node);
				continue;
			} else if (isLeaf(node.node) && (currentOffset < updateOffsetStart)) {
				precedingNodes.push({ length: updateOffsetStart - currentOffset, token: node.node.token, height: 0, tokenQuality: node.node.tokenQuality });
			}

			if ((updateOffsetStart <= currentOffset) && (currentOffset + node.node.length <= firstUnchangedOffsetAfterUpdate)) {
				continue;
			}

			if (currentOffset >= firstUnchangedOffsetAfterUpdate) {
				if (!isLeaf(node.node)) {
					node.node.parent = undefined;
				}
				postcedingNodes.push(node.node);
				continue;
			} else if (isLeaf(node.node) && (currentOffset + node.node.length > firstUnchangedOffsetAfterUpdate)) {
				postcedingNodes.push({ length: currentOffset + node.node.length - firstUnchangedOffsetAfterUpdate, token: node.node.token, height: 0, tokenQuality: node.node.tokenQuality });
				continue;
			}

			if (!isLeaf(node.node)) {
				let childOffset = currentOffset + node.node.length;
				for (let i = node.node.children.length - 1; i >= 0; i--) {
					childOffset -= node.node.children[i].length;
					stack.push({ node: node.node.children[i], offset: childOffset });
				}
			}
		}

		let allNodes: Node[];
		if (tokens.length > 0) {
			allNodes = precedingNodes.concat(this.createFromUpdates(tokens, tokenQuality), postcedingNodes);
		} else {
			allNodes = precedingNodes.concat(postcedingNodes);
		}
		let newRoot: Node = allNodes[0];
		for (let i = 1; i < allNodes.length; i++) {
			newRoot = concat(newRoot, allNodes[i]);
		}

		this._root = newRoot ?? this.createEmptyRoot();
	}

	private traverseInOrderInRange(startOffsetInclusive: number, endOffsetExclusive: number, visitor: (node: Node, offset: number) => boolean): void {
		const stack: { node: Node; offset: number }[] = [{ node: this._root, offset: 0 }];

		while (stack.length > 0) {
			const { node, offset } = stack.pop()!;
			const nodeEnd = offset + node.length;

			if (nodeEnd <= startOffsetInclusive || offset >= endOffsetExclusive) {
				continue;
			}

			if (visitor(node, offset)) {
				return;
			}

			if (!isLeaf(node)) {
				let childOffset = offset + node.length;
				for (let i = node.children.length - 1; i >= 0; i--) {
					childOffset -= node.children[i].length;
					stack.push({ node: node.children[i], offset: childOffset });
				}
			}
		}
	}

	getTokenAt(offset: number): TokenUpdate | undefined {
		let result: TokenUpdate | undefined;
		this.traverseInOrderInRange(offset, this._root.length, (node, offset) => {
			if (isLeaf(node)) {
				result = { token: node.token, startOffsetInclusive: offset, length: node.length };
				return true;
			}
			return false;
		});
		return result;
	}

	getTokensInRange(startOffsetInclusive: number, endOffsetExclusive: number): TokenUpdate[] {
		const result: { token: number; startOffsetInclusive: number; length: number }[] = [];
		this.traverseInOrderInRange(startOffsetInclusive, endOffsetExclusive, (node, offset) => {
			if (isLeaf(node)) {
				let clippedLength = node.length;
				let clippedOffset = offset;
				if ((offset < startOffsetInclusive) && (offset + node.length > endOffsetExclusive)) {
					clippedOffset = startOffsetInclusive;
					clippedLength = endOffsetExclusive - startOffsetInclusive;
				} else if (offset < startOffsetInclusive) {
					clippedLength -= (startOffsetInclusive - offset);
					clippedOffset = startOffsetInclusive;
				} else if (offset + node.length > endOffsetExclusive) {
					clippedLength -= (offset + node.length - endOffsetExclusive);
				}
				result.push({ token: node.token, startOffsetInclusive: clippedOffset, length: clippedLength });
			}
			return false;
		});
		return result;
	}

	markForRefresh(startOffsetInclusive: number, endOffsetExclusive: number): void {
		this.traverseInOrderInRange(startOffsetInclusive, endOffsetExclusive, (node) => {
			if (isLeaf(node)) {
				node.tokenQuality = TokenQuality.None;
			}
			return false;
		});
	}

	rangeHasTokens(startOffsetInclusive: number, endOffsetExclusive: number, minimumTokenQuality: TokenQuality): boolean {
		let hasAny = true;
		this.traverseInOrderInRange(startOffsetInclusive, endOffsetExclusive, (node) => {
			if (isLeaf(node) && (node.tokenQuality < minimumTokenQuality)) {
				hasAny = false;
			}
			return false;
		});
		return hasAny;
	}

	rangeNeedsRefresh(startOffsetInclusive: number, endOffsetExclusive: number): boolean {
		let needsRefresh = false;
		this.traverseInOrderInRange(startOffsetInclusive, endOffsetExclusive, (node) => {
			if (isLeaf(node) && (node.tokenQuality !== TokenQuality.Accurate)) {
				needsRefresh = true;
			}
			return false;
		});
		return needsRefresh;
	}

	getNeedsRefresh(): { startOffset: number; endOffset: number }[] {
		const result: { startOffset: number; endOffset: number }[] = [];

		this.traverseInOrderInRange(0, this._textModel.getValueLength(), (node, offset) => {
			if (isLeaf(node) && (node.tokenQuality !== TokenQuality.Accurate)) {
				if ((result.length > 0) && (result[result.length - 1].endOffset === offset)) {
					result[result.length - 1].endOffset += node.length;
				} else {
					result.push({ startOffset: offset, endOffset: offset + node.length });
				}
			}
			return false;
		});
		return result;
	}

	public deepCopy(): TokenStore {
		const newStore = new TokenStore(this._textModel);
		newStore._root = this._copyNodeIterative(this._root);
		return newStore;
	}

	private _copyNodeIterative(root: Node): Node {
		const newRoot = isLeaf(root)
			? { length: root.length, token: root.token, tokenQuality: root.tokenQuality, height: root.height }
			: new ListNode(root.height);

		const stack: Array<[Node, Node]> = [[root, newRoot]];

		while (stack.length > 0) {
			const [oldNode, clonedNode] = stack.pop()!;
			if (!isLeaf(oldNode)) {
				for (const child of oldNode.children) {
					const childCopy = isLeaf(child)
						? { length: child.length, token: child.token, tokenQuality: child.tokenQuality, height: child.height }
						: new ListNode(child.height);

					(clonedNode as ListNode).appendChild(childCopy);
					stack.push([child, childCopy]);
				}
			}
		}

		return newRoot;
	}

	printTree(root: Node = this._root): string {
		const result: string[] = [];
		const stack: Array<[Node, number]> = [[root, 0]];

		while (stack.length > 0) {
			const [node, depth] = stack.pop()!;
			const indent = '  '.repeat(depth);

			if (isLeaf(node)) {
				result.push(`${indent}Leaf(length: ${node.length}, token: ${node.token}, refresh: ${node.tokenQuality})\n`);
			} else {
				result.push(`${indent}List(length: ${node.length})\n`);
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push([node.children[i], depth + 1]);
				}
			}
		}

		return result.join('');
	}

	dispose(): void {
		const stack: Array<[Node, boolean]> = [[this._root, false]];
		while (stack.length > 0) {
			const [node, visited] = stack.pop()!;
			if (isLeaf(node)) {
			} else if (!visited) {
				stack.push([node, true]);
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push([node.children[i], false]);
				}
			} else {
				node.dispose();
				node.parent = undefined;
			}
		}
		this._root = undefined!;
	}
}
