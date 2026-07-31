export interface IIntervalNode {
	start: number;
	end: number;
	id: string;
}

interface ITreeNode {
	start: number;
	intervals: IIntervalNode[];
	maxEnd: number;
	left: ITreeNode | null;
	right: ITreeNode | null;
	height: number;
}

function nodeHeight(node: ITreeNode | null): number {
	return node ? node.height : 0;
}

function nodeMaxEnd(node: ITreeNode | null): number {
	return node ? node.maxEnd : -Infinity;
}

function recompute(node: ITreeNode): void {
	const leftMax = nodeMaxEnd(node.left);
	const rightMax = nodeMaxEnd(node.right);
	let max = Math.max(leftMax, rightMax);
	for (const interval of node.intervals) {
		if (interval.end > max) {
			max = interval.end;
		}
	}
	node.maxEnd = max;
	node.height = Math.max(nodeHeight(node.left), nodeHeight(node.right)) + 1;
}

function rotateRight(y: ITreeNode): ITreeNode {
	const x = y.left as ITreeNode;
	y.left = x.right;
	x.right = y;
	recompute(y);
	recompute(x);
	return x;
}

function rotateLeft(x: ITreeNode): ITreeNode {
	const y = x.right as ITreeNode;
	x.right = y.left;
	y.left = x;
	recompute(x);
	recompute(y);
	return y;
}

function rebalance(node: ITreeNode): ITreeNode {
	recompute(node);
	const balance = nodeHeight(node.left) - nodeHeight(node.right);
	if (balance > 1) {
		const left = node.left as ITreeNode;
		if (nodeHeight(left.left) < nodeHeight(left.right)) {
			node.left = rotateLeft(left);
		}
		return rotateRight(node);
	}
	if (balance < -1) {
		const right = node.right as ITreeNode;
		if (nodeHeight(right.right) < nodeHeight(right.left)) {
			node.right = rotateRight(right);
		}
		return rotateLeft(node);
	}
	return node;
}

function insertNode(root: ITreeNode | null, node: ITreeNode): ITreeNode {
	if (!root) {
		return node;
	}
	if (node.start < root.start) {
		root.left = insertNode(root.left, node);
	} else if (node.start > root.start) {
		root.right = insertNode(root.right, node);
	} else {
		root.intervals.push(...node.intervals);
		recompute(root);
		return root;
	}
	return rebalance(root);
}

function findMin(node: ITreeNode): ITreeNode {
	let current = node;
	while (current.left) {
		current = current.left;
	}
	return current;
}

function deleteNode(root: ITreeNode | null, start: number): ITreeNode | null {
	if (!root) {
		return null;
	}
	if (start < root.start) {
		root.left = deleteNode(root.left, start);
	} else if (start > root.start) {
		root.right = deleteNode(root.right, start);
	} else {
		if (root.intervals.length > 0) {
			return root;
		}
		if (!root.left) {
			return root.right;
		}
		if (!root.right) {
			return root.left;
		}
		const successor = findMin(root.right);
		root.start = successor.start;
		root.intervals = successor.intervals;
		root.right = deleteNode(root.right, successor.start);
	}
	return rebalance(root);
}

function collectNode(root: ITreeNode, start: number, end: number, out: IIntervalNode[]): void {
	if (root.left && root.left.maxEnd >= start) {
		collectNode(root.left, start, end, out);
	}
	if (root.start <= end) {
		for (const interval of root.intervals) {
			if (interval.end >= start) {
				out.push(interval);
			}
		}
		if (root.right) {
			collectNode(root.right, start, end, out);
		}
	}
}

export class IntervalTree {
	private _root: ITreeNode | null = null;

	public insert(node: IIntervalNode): void {
		this._root = insertNode(this._root, this._createNode(node));
	}

	public delete(node: IIntervalNode): boolean {
		if (!this._root) {
			return false;
		}
		const start = node.start;
		let current = this._root;
		let removed = false;
		while (current) {
			if (current.start === start) {
				const index = current.intervals.findIndex(i => i.id === node.id);
				if (index !== -1) {
					current.intervals.splice(index, 1);
					removed = true;
				}
				if (current.intervals.length === 0) {
					this._root = deleteNode(this._root, start);
				} else {
					recompute(current);
				}
				return removed;
			}
			if (start < current.start) {
				current = current.left;
			} else {
				current = current.right;
			}
		}
		return removed;
	}

	public search(start: number, end: number): IIntervalNode[] {
		const result: IIntervalNode[] = [];
		if (this._root && this._root.maxEnd >= start) {
			collectNode(this._root, start, end, result);
		}
		return result;
	}

	public getMaxEnd(): number {
		return nodeMaxEnd(this._root);
	}

	public getSize(): number {
		let count = 0;
		const stack: ITreeNode[] = [];
		let node = this._root;
		while (node || stack.length > 0) {
			while (node) {
				stack.push(node);
				node = node.left;
			}
			node = stack.pop() as ITreeNode;
			count += node.intervals.length;
			node = node.right;
		}
		return count;
	}

	public getAll(): IIntervalNode[] {
		const result: IIntervalNode[] = [];
		const stack: ITreeNode[] = [];
		let node = this._root;
		while (node || stack.length > 0) {
			while (node) {
				stack.push(node);
				node = node.left;
			}
			node = stack.pop() as ITreeNode;
			result.push(...node.intervals);
			node = node.right;
		}
		return result;
	}

	public clear(): void {
		this._root = null;
	}

	private _createNode(interval: IIntervalNode): ITreeNode {
		return {
			start: interval.start,
			intervals: [interval],
			maxEnd: interval.end,
			left: null,
			right: null,
			height: 1,
		};
	}
}

export function intervalNodeStart(a: IIntervalNode, b: IIntervalNode): number {
	return a.start - b.start;
}

export function intervalNodeEnd(a: IIntervalNode, b: IIntervalNode): number {
	return a.end - b.end;
}

export function intervalNodeEquals(a: IIntervalNode, b: IIntervalNode): boolean {
	return a.id === b.id && a.start === b.start && a.end === b.end;
}
