/**
 * Dardcor Code - Golden-Layout Style Flexible Split Pane Grid System
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';
import { $, clearNode } from '../../core/dom/element';
import { Sash, SashOrientation, ISashDragEvent } from './sash';

export const enum Orientation {
	HORIZONTAL = 0,
	VERTICAL = 1,
}

export const enum Direction {
	Up = 0,
	Down = 1,
	Left = 2,
	Right = 3,
}

export interface GridLeafNode {
	readonly type: 'leaf';
	readonly id: string;
	readonly view: HTMLElement;
	size: number;
	minSize: number;
}

export interface GridBranchNode {
	readonly type: 'branch';
	orientation: Orientation;
	children: GridNode[];
	sizes: number[];
	element: HTMLElement;
}

export type GridNode = GridLeafNode | GridBranchNode;

interface IGridSashEntry {
	readonly branch: GridBranchNode;
	readonly index: number;
	readonly sash: Sash;
}

export class GridLayout extends Disposable {
	private readonly _container: HTMLElement;
	private _root: GridNode | null = null;
	private readonly _leafs = new Map<string, GridLeafNode>();
	private readonly _sashes: IGridSashEntry[] = [];
	private _width = 0;
	private _height = 0;
	private _observer: ResizeObserver | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	constructor(
		container: HTMLElement,
		private readonly _defaultMinSize = 100
	) {
		super();
		this._container = container;
		this._container.style.position = 'relative';
		this._container.style.overflow = 'hidden';
		this._observer = new ResizeObserver(() => this.layout());
		this._observer.observe(container);
	}

	get root(): GridNode | null {
		return this._root;
	}

	get hasRoot(): boolean {
		return this._root !== null;
	}

	get container(): HTMLElement {
		return this._container;
	}

	getViewSize(id: string): number {
		const leaf = this._leafs.get(id);
		if (!leaf) {
			return 0;
		}
		const length = this._orientationOf(leaf) === Orientation.HORIZONTAL ? this._width : this._height;
		return leaf.size * length;
	}

	getNode(id: string): GridNode | null {
		return this._leafs.get(id) ?? null;
	}

	addView(view: HTMLElement, relativeToId?: string, direction: Direction = Direction.Right, size?: number): string {
		const id = `grid-leaf-${Math.random().toString(36).slice(2, 10)}`;
		const leaf: GridLeafNode = { type: 'leaf', id, view, size: size ?? 0.5, minSize: this._defaultMinSize };

		if (!this._root) {
			leaf.size = 1;
			this._root = leaf;
		} else if (relativeToId) {
			const target = this._leafs.get(relativeToId);
			if (target) {
				this._replaceLeafWithBranch(target, leaf, direction);
			} else {
				this._root = this._wrapInBranch(this._root, leaf, direction);
			}
		} else {
			this._root = this._wrapInBranch(this._root, leaf, direction);
		}

		this._leafs.set(id, leaf);
		this._render();
		this.layout();
		this._onDidChange.fire();
		return id;
	}

	removeView(id: string): void {
		const leaf = this._leafs.get(id);
		if (!leaf) {
			return;
		}
		this._leafs.delete(id);

		if (this._root === leaf) {
			this._root = null;
		} else {
			this._removeLeafFromTree(this._root, leaf);
		}
		this._render();
		this.layout();
		this._onDidChange.fire();
	}

	layout(): void {
		const width = this._container.clientWidth;
		const height = this._container.clientHeight;
		if (width <= 0 || height <= 0) {
			return;
		}
		this._width = width;
		this._height = height;
		if (this._root) {
			this._layoutNode(this._root, 0, 0, width, height);
		}
	}

	private _orientationOf(leaf: GridLeafNode): Orientation {
		const parent = this._findParent(this._root, leaf);
		return parent ? parent.orientation : Orientation.HORIZONTAL;
	}

	private _wrapInBranch(first: GridNode, second: GridNode, direction: Direction): GridBranchNode {
		const isFirstOnLeft = direction === Direction.Left || direction === Direction.Up;
		const orientation = direction === Direction.Up || direction === Direction.Down ? Orientation.VERTICAL : Orientation.HORIZONTAL;
		const element = $<HTMLElement>('div', 'dc-grid-branch');
		element.style.cssText = 'position:absolute;overflow:hidden;';
		return {
			type: 'branch',
			orientation,
			children: isFirstOnLeft ? [first, second] : [second, first],
			sizes: [0.5, 0.5],
			element,
		};
	}

	private _replaceLeafWithBranch(target: GridLeafNode, newcomer: GridLeafNode, direction: Direction): void {
		const branch = this._wrapInBranch(target, newcomer, direction);
		if (this._root === target) {
			this._root = branch;
			return;
		}
		const parent = this._findParent(this._root, target);
		if (!parent) {
			return;
		}
		const idx = parent.children.indexOf(target);
		parent.children[idx] = branch;
		parent.sizes[idx] = target.size;
	}

	private _removeLeafFromTree(node: GridNode | null, leaf: GridLeafNode): void {
		if (!node || node.type === 'leaf') {
			return;
		}
		const idx = node.children.indexOf(leaf);
		if (idx !== -1) {
			node.children.splice(idx, 1);
			node.sizes.splice(idx, 1);
			if (node.children.length === 1) {
				const survivor = node.children[0];
				const parent = this._findParent(this._root, node);
				if (parent) {
					const pi = parent.children.indexOf(node);
					parent.children[pi] = survivor;
					parent.sizes[pi] = 1;
				} else {
					this._root = survivor;
				}
			} else {
				const total = node.sizes.reduce((a, b) => a + b, 0) || 1;
				node.sizes = node.sizes.map(s => s / total);
			}
			return;
		}
		for (const child of node.children) {
			this._removeLeafFromTree(child, leaf);
		}
	}

	private _findParent(node: GridNode | null, child: GridNode): GridBranchNode | null {
		if (!node || node.type === 'leaf') {
			return null;
		}
		if (node.children.indexOf(child) !== -1) {
			return node;
		}
		for (const c of node.children) {
			const res = this._findParent(c, child);
			if (res) {
				return res;
			}
		}
		return null;
	}

	private _render(): void {
		for (const entry of this._sashes) {
			entry.sash.dispose();
		}
		this._sashes.length = 0;
		clearNode(this._container);

		if (!this._root) {
			return;
		}
		this._appendNode(this._container, this._root);
	}

	private _appendNode(parent: HTMLElement, node: GridNode): void {
		if (node.type === 'leaf') {
			parent.appendChild(node.view);
			node.view.style.position = 'absolute';
			return;
		}
		parent.appendChild(node.element);
		for (const child of node.children) {
			this._appendNode(node.element, child);
		}
	}

	private _layoutNode(node: GridNode, x: number, y: number, w: number, h: number): void {
		if (node.type === 'leaf') {
			const el = node.view;
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
			el.style.width = `${w}px`;
			el.style.height = `${h}px`;
			return;
		}

		const el = node.element;
		el.style.left = `${x}px`;
		el.style.top = `${y}px`;
		el.style.width = `${w}px`;
		el.style.height = `${h}px`;

		const horizontal = node.orientation === Orientation.HORIZONTAL;
		const length = horizontal ? w : h;
		let acc = 0;
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i];
			const childLength = length * node.sizes[i];
			const childX = horizontal ? x + acc : x;
			const childY = horizontal ? y : y + acc;
			this._layoutNode(child, childX, childY, horizontal ? childLength : w, horizontal ? h : childLength);
			acc += childLength;

			if (i < node.children.length - 1) {
				let sashEntry = this._sashes.find(e => e.branch === node && e.index === i);
				if (!sashEntry) {
					const sash = new Sash(this._container, horizontal ? SashOrientation.VERTICAL : SashOrientation.HORIZONTAL);
					this._register(sash);
					sashEntry = { branch: node, index: i, sash };
					this._sashes.push(sashEntry);
					sash.onDidChange(ev => this._onSashDrag(sashEntry!, ev));
					sash.onDidReset(() => {
						node.sizes[i] = 0.5;
						node.sizes[i + 1] = 0.5;
						this.layout();
					});
				}
				const sashPos = horizontal ? x + acc : y + acc;
				sashEntry.sash.layout(sashPos);
			}
		}
	}

	private _onSashDrag(entry: IGridSashEntry, ev: ISashDragEvent): void {
		const { branch, index } = entry;
		const horizontal = branch.orientation === Orientation.HORIZONTAL;
		const length = horizontal ? this._width : this._height;
		if (length <= 0) {
			return;
		}
		const delta = horizontal ? ev.deltaX : ev.deltaY;
		const firstChild = branch.children[index] as GridLeafNode;
		const secondChild = branch.children[index + 1] as GridLeafNode;
		const minFrac = firstChild.minSize / length;
		const siblingMinFrac = secondChild.minSize / length;

		let newSize = branch.sizes[index] + delta / length;
		newSize = Math.max(minFrac, Math.min(1 - siblingMinFrac, newSize));
		branch.sizes[index] = newSize;
		branch.sizes[index + 1] = 1 - newSize;
		this.layout();
		this._onDidChange.fire();
	}

	dispose(): void {
		this._observer?.disconnect();
		this._observer = null;
		clearNode(this._container);
		super.dispose();
	}
}
