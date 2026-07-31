/**
 * Dardcor Code - Red-Black Tree for PieceTree Line & Offset Tracking (Task 202)
 * Mirrors: vs/editor/common/model/pieceTreeTextBuffer/rbTreeBase.ts
 */

export const enum NodeColor {
	Red = 0,
	Black = 1,
}

export interface IRBNode<T> {
	piece: T;
	color: NodeColor;
	left: IRBNode<T>;
	right: IRBNode<T>;
	parent: IRBNode<T>;
	size_left: number; // total length of left subtree
	lf_left: number; // total line feeds in left subtree
}

export const SENTINEL: IRBNode<any> = {
	piece: null,
	color: NodeColor.Black,
	left: null as any,
	right: null as any,
	parent: null as any,
	size_left: 0,
	lf_left: 0,
};
SENTINEL.left = SENTINEL;
SENTINEL.right = SENTINEL;
SENTINEL.parent = SENTINEL;

export class RBTree<T> {
	root: IRBNode<T> = SENTINEL;

	constructor() {}

	createNode(piece: T, color: NodeColor = NodeColor.Red): IRBNode<T> {
		return {
			piece,
			color,
			left: SENTINEL,
			right: SENTINEL,
			parent: SENTINEL,
			size_left: 0,
			lf_left: 0,
		};
	}

	leftRotate(x: IRBNode<T>): void {
		const y = x.right;
		x.right = y.left;
		if (y.left !== SENTINEL) {
			y.left.parent = x;
		}
		y.parent = x.parent;
		if (x.parent === SENTINEL) {
			this.root = y;
		} else if (x === x.parent.left) {
			x.parent.left = y;
		} else {
			x.parent.right = y;
		}
		y.left = x;
		x.parent = y;
	}

	rightRotate(y: IRBNode<T>): void {
		const x = y.left;
		y.left = x.right;
		if (x.right !== SENTINEL) {
			x.right.parent = y;
		}
		x.parent = y.parent;
		if (y.parent === SENTINEL) {
			this.root = x;
		} else if (y === y.parent.right) {
			y.parent.right = x;
		} else {
			y.parent.left = x;
		}
		x.right = y;
		y.parent = x;
	}
}
