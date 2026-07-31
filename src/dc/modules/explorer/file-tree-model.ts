/**
 * Dardcor Code - File & Directory Tree Data Model
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';
import { Path } from '../../core/types/path.js';
import { IFileService, IFileStat } from '../../services/files/file-service.js';

export interface IFileTreeElement {
	readonly resource: URI;
	readonly name: string;
	readonly isDirectory: boolean;
	readonly size: number;
	readonly mtime: number;
}

export class FileTreeNode {
	public readonly element: IFileTreeElement;
	public readonly children: FileTreeNode[] = [];
	public parent: FileTreeNode | undefined;
	public depth = 0;
	public collapsed = true;
	public visible = true;
	public loaded = false;
	public loading = false;

	constructor(element: IFileTreeElement, parent?: FileTreeNode, depth = 0) {
		this.element = element;
		this.parent = parent;
		this.depth = depth;
	}

	public get isDirectory(): boolean {
		return this.element.isDirectory;
	}

	public get resource(): URI {
		return this.element.resource;
	}

	public get path(): string {
		return this.element.resource.path;
	}
}

function compareTreeEntries(a: IFileTreeElement, b: IFileTreeElement): number {
	if (a.isDirectory !== b.isDirectory) {
		return a.isDirectory ? -1 : 1;
	}
	return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

function statToElement(stat: IFileStat): IFileTreeElement {
	return {
		resource: stat.resource,
		name: stat.name,
		isDirectory: stat.isDirectory,
		size: stat.size,
		mtime: stat.mtime
	};
}

export class FileTreeModel extends Disposable {
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidRefresh = this._register(new Emitter<FileTreeNode>());
	readonly onDidRefresh: Event<FileTreeNode> = this._onDidRefresh.event;

	private _root: FileTreeNode | undefined;

	constructor(private readonly _fileService: IFileService) {
		super();
	}

	get root(): FileTreeNode | undefined {
		return this._root;
	}

	public async setRoot(uri: URI): Promise<void> {
		let stat: IFileStat;
		try {
			stat = await this._fileService.stat(uri);
		} catch (err) {
			this._root = undefined;
			this._onDidChange.fire();
			return;
		}
		this._root = new FileTreeNode(statToElement(stat), undefined, 0);
		this._root.collapsed = false;
		await this.loadChildren(this._root);
		this._onDidChange.fire();
	}

	public async loadChildren(node: FileTreeNode): Promise<void> {
		if (!node.isDirectory || node.loaded || node.loading) {
			return;
		}
		node.loading = true;
		try {
			const stat = await this._fileService.stat(node.resource);
			const children = (stat.children ?? []).map(c => new FileTreeNode(statToElement(c), node, node.depth + 1));
			children.sort((a, b) => compareTreeEntries(a.element, b.element));
			node.children.splice(0, node.children.length, ...children);
			node.loaded = true;
			this._onDidRefresh.fire(node);
		} catch (err) {
			node.loaded = true;
		} finally {
			node.loading = false;
		}
	}

	public async expand(node: FileTreeNode): Promise<void> {
		if (node.collapsed) {
			await this.loadChildren(node);
			node.collapsed = false;
			this._onDidChange.fire();
		}
	}

	public async collapse(node: FileTreeNode): Promise<void> {
		if (!node.collapsed) {
			node.collapsed = true;
			this._onDidChange.fire();
		}
	}

	public async toggle(node: FileTreeNode): Promise<void> {
		if (node.collapsed) {
			await this.expand(node);
		} else {
			await this.collapse(node);
		}
	}

	public async refreshNode(node: FileTreeNode): Promise<void> {
		node.loaded = false;
		node.children.splice(0, node.children.length);
		await this.loadChildren(node);
		this._onDidChange.fire();
	}

	public async expandTo(node: FileTreeNode): Promise<void> {
		const ancestors: FileTreeNode[] = [];
		let current: FileTreeNode | undefined = node.parent;
		while (current) {
			ancestors.unshift(current);
			current = current.parent;
		}
		for (const ancestor of ancestors) {
			ancestor.collapsed = false;
			await this.loadChildren(ancestor);
		}
		this._onDidChange.fire();
	}

	public getVisibleNodes(): FileTreeNode[] {
		const result: FileTreeNode[] = [];
		const walk = (nodes: FileTreeNode[]) => {
			for (const node of nodes) {
				if (node.visible === false) {
					continue;
				}
				result.push(node);
				if (!node.collapsed && node.children.length > 0) {
					walk(node.children);
				}
			}
		};
		if (this._root) {
			walk([this._root]);
		}
		return result;
	}

	public getNodeByPath(path: string): FileTreeNode | undefined {
		const search = (nodes: FileTreeNode[]): FileTreeNode | undefined => {
			for (const node of nodes) {
				if (Path.normalize(node.path) === Path.normalize(path)) {
					return node;
				}
				const found = search(node.children);
				if (found) {
					return found;
				}
			}
			return undefined;
		};
		return this._root ? search([this._root]) : undefined;
	}

	public getParent(node: FileTreeNode): FileTreeNode | undefined {
		return node.parent;
	}

	public getPreviousSibling(node: FileTreeNode): FileTreeNode | undefined {
		if (!node.parent) {
			return undefined;
		}
		const idx = node.parent.children.indexOf(node);
		return idx > 0 ? node.parent.children[idx - 1] : undefined;
	}

	public getNextSibling(node: FileTreeNode): FileTreeNode | undefined {
		if (!node.parent) {
			return undefined;
		}
		const idx = node.parent.children.indexOf(node);
		return idx >= 0 && idx < node.parent.children.length - 1 ? node.parent.children[idx + 1] : undefined;
	}

	public deleteNode(node: FileTreeNode): void {
		if (!node.parent) {
			this._root = undefined;
		} else {
			const idx = node.parent.children.indexOf(node);
			if (idx !== -1) {
				node.parent.children.splice(idx, 1);
			}
		}
		this._onDidChange.fire();
	}

	public insertNode(parent: FileTreeNode, element: IFileTreeElement, index?: number): FileTreeNode {
		const node = new FileTreeNode(element, parent, parent.depth + 1);
		if (index === undefined) {
			parent.children.push(node);
		} else {
			parent.children.splice(index, 0, node);
		}
		parent.children.sort((a, b) => compareTreeEntries(a.element, b.element));
		this._onDidChange.fire();
		return node;
	}

	public dispose(): void {
		super.dispose();
	}
}
