/**
 * Dardcor Code - Virtualized Tree UI Base (Task 82)
 * Mirrors: vs/base/browser/ui/tree/
 */

import { IDisposable } from '../lifecycle/disposable.js';
import { Emitter, Event } from '../events/emitter.js';

export interface ITreeNode<T> {
	readonly element: T;
	readonly children: ITreeNode<T>[];
	readonly depth: number;
	collapsed: boolean;
	visible: boolean;
}

export interface ITreeRenderer<T> {
	renderElement(node: ITreeNode<T>, index: number, container: HTMLElement): void;
	disposeElement?(node: ITreeNode<T>, index: number, container: HTMLElement): void;
}

export interface ITreeModel<T> {
	getNodeAt(index: number): ITreeNode<T> | undefined;
	getVisibleCount(): number;
	setCollapsed(node: ITreeNode<T>, collapsed: boolean): void;
}

export class VirtualTreeView<T> implements IDisposable {
	private readonly _container: HTMLElement;
	private readonly _scrollContainer: HTMLElement;
	private readonly _rowHeight: number;
	private readonly _renderer: ITreeRenderer<T>;
	private _nodes: ITreeNode<T>[] = [];
	private _visibleNodes: ITreeNode<T>[] = [];
	private readonly _rowPool: HTMLElement[] = [];
	private readonly _onDidClick = new Emitter<ITreeNode<T>>();
	private readonly _onDidToggle = new Emitter<ITreeNode<T>>();

	readonly onDidClick: Event<ITreeNode<T>> = this._onDidClick.event;
	readonly onDidToggle: Event<ITreeNode<T>> = this._onDidToggle.event;

	constructor(container: HTMLElement, renderer: ITreeRenderer<T>, rowHeight: number = 22) {
		this._container = container;
		this._rowHeight = rowHeight;
		this._renderer = renderer;

		this._scrollContainer = document.createElement('div');
		this._scrollContainer.style.overflow = 'auto';
		this._scrollContainer.style.height = '100%';
		this._scrollContainer.style.position = 'relative';
		this._container.appendChild(this._scrollContainer);

		this._scrollContainer.addEventListener('scroll', () => this._render());
	}

	setInput(roots: ITreeNode<T>[]): void {
		this._nodes = roots;
		this._refreshVisibleNodes();
		this._render();
	}

	private _refreshVisibleNodes(): void {
		this._visibleNodes = [];
		const walk = (nodes: ITreeNode<T>[]) => {
			for (const node of nodes) {
				if (node.visible !== false) {
					this._visibleNodes.push(node);
					if (!node.collapsed && node.children.length > 0) {
						walk(node.children);
					}
				}
			}
		};
		walk(this._nodes);
		this._scrollContainer.style.height = `${this._visibleNodes.length * this._rowHeight}px`;
	}

	private _render(): void {
		const scrollTop = this._scrollContainer.scrollTop;
		const viewHeight = this._container.clientHeight;
		const startIdx = Math.floor(scrollTop / this._rowHeight);
		const endIdx = Math.min(
			this._visibleNodes.length,
			Math.ceil((scrollTop + viewHeight) / this._rowHeight)
		);

		// Clear previous rows
		while (this._scrollContainer.children.length > 0) {
			const child = this._scrollContainer.lastChild!;
			this._scrollContainer.removeChild(child);
			if (child instanceof HTMLElement) this._rowPool.push(child);
		}

		for (let i = startIdx; i < endIdx; i++) {
			const node = this._visibleNodes[i];
			if (!node) continue;
			const row = this._rowPool.pop() || document.createElement('div');
			row.className = 'dc-tree-row';
			row.style.position = 'absolute';
			row.style.top = `${i * this._rowHeight}px`;
			row.style.height = `${this._rowHeight}px`;
			row.style.width = '100%';
			row.style.paddingLeft = `${node.depth * 16}px`;
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.cursor = 'pointer';
			row.style.boxSizing = 'border-box';
			row.innerHTML = '';

			this._renderer.renderElement(node, i, row);

			row.onclick = () => {
				if (node.children.length > 0) {
					node.collapsed = !node.collapsed;
					this._onDidToggle.fire(node);
					this._refreshVisibleNodes();
					this._render();
				} else {
					this._onDidClick.fire(node);
				}
			};

			this._scrollContainer.appendChild(row);
		}
	}

	refresh(): void {
		this._refreshVisibleNodes();
		this._render();
	}

	dispose(): void {
		this._scrollContainer.remove();
		this._onDidClick.dispose();
		this._onDidToggle.dispose();
	}
}

export function buildTreeNode<T>(element: T, children: ITreeNode<T>[] = [], depth: number = 0): ITreeNode<T> {
	return {
		element,
		children,
		depth,
		collapsed: false,
		visible: true,
	};
}
