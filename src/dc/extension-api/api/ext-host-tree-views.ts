import { Disposable, IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { URI } from '../../core/types/uri.js';

export interface ITreeItem {
	label?: string;
	description?: string;
	tooltip?: string;
	iconPath?: URI | { light: URI; dark: URI } | string;
	collapsibleState?: number;
	command?: { command: string; title?: string; arguments?: any[] };
	contextValue?: string;
}

export interface ITreeDataProvider<T> {
	getChildren(element?: T): T[] | Promise<T[]> | undefined | null;
	getTreeItem(element: T): ITreeItem | Promise<ITreeItem>;
	onDidChangeTreeData?: Event<T | undefined | null | void>;
}

export interface ITreeViewOptions<T> {
	treeDataProvider: ITreeDataProvider<T>;
	showCollapseAll?: boolean;
	canSelectMany?: boolean;
}

export interface TreeView<T> extends IDisposable {
	readonly viewId: string;
	visible: boolean;
	title?: string;
	description?: string;
	message?: string;
	reveal(element: T, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void>;
	readonly onDidChangeVisibility: Event<{ visible: boolean }>;
	readonly onDidChangeSelection: Event<readonly T[]>;
	dispose(): void;
}

export class ExtHostTreeViews extends Disposable {
	private readonly _views = new Map<string, ExtHostTreeView<any>>();

	public createTreeView<T>(viewId: string, options: ITreeViewOptions<T>): TreeView<T> {
		if (this._views.has(viewId)) {
			throw new Error(`Tree view '${viewId}' sudah terdaftar`);
		}
		const view = new ExtHostTreeView<T>(viewId, options, () => {
			this._views.delete(viewId);
		});
		this._views.set(viewId, view);
		return view;
	}

	public getView(viewId: string): ExtHostTreeView<any> | undefined {
		return this._views.get(viewId);
	}

	public getViews(): ExtHostTreeView<any>[] {
		return [...this._views.values()];
	}

	public getVisibleViews(): ExtHostTreeView<any>[] {
		return [...this._views.values()].filter(view => view.visible);
	}

	public setVisible(viewId: string, visible: boolean): void {
		this._views.get(viewId)?.setVisible(visible);
	}

	public override dispose(): void {
		for (const view of this._views.values()) {
			view.dispose();
		}
		this._views.clear();
		super.dispose();
	}
}

export class ExtHostTreeView<T> extends Disposable implements TreeView<T> {
	private _visible = false;
	private _title: string | undefined;
	private _description: string | undefined;
	private _message: string | undefined;

	private readonly _onDidChangeVisibility = this._register(new Emitter<{ visible: boolean }>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private readonly _onDidChangeSelection = this._register(new Emitter<readonly T[]>());
	readonly onDidChangeSelection = this._onDidChangeSelection.event;

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose = this._onDidDispose.event;

	constructor(
		public readonly viewId: string,
		private readonly _options: ITreeViewOptions<T>,
		private readonly _onDisposeCallback: () => void
	) {
		super();
		const onDidChangeTreeData = _options.treeDataProvider.onDidChangeTreeData;
		if (onDidChangeTreeData) {
			this._register(onDidChangeTreeData(() => undefined));
		}
	}

	public get visible(): boolean {
		return this._visible;
	}

	public setVisible(visible: boolean): void {
		if (this._visible !== visible) {
			this._visible = visible;
			this._onDidChangeVisibility.fire({ visible });
		}
	}

	public get title(): string | undefined {
		return this._title;
	}

	public set title(value: string | undefined) {
		this._title = value;
	}

	public get description(): string | undefined {
		return this._description;
	}

	public set description(value: string | undefined) {
		this._description = value;
	}

	public get message(): string | undefined {
		return this._message;
	}

	public set message(value: string | undefined) {
		this._message = value;
	}

	public async reveal(element: T, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Promise<void> {
		const found = await this._findElement(element);
		if (!found) {
			throw new Error(`Elemen tidak ditemukan di tree view '${this.viewId}'`);
		}
		this.setVisible(true);
		if (options?.select) {
			this._onDidChangeSelection.fire([found]);
		}
	}

	public async getChildren(element?: T): Promise<T[]> {
		const children = await this._options.treeDataProvider.getChildren(element);
		return children ?? [];
	}

	public async getTreeItem(element: T): Promise<ITreeItem> {
		return this._options.treeDataProvider.getTreeItem(element);
	}

	public getDataProvider(): ITreeDataProvider<T> {
		return this._options.treeDataProvider;
	}

	public override dispose(): void {
		this._onDidDispose.fire();
		this._onDisposeCallback();
		super.dispose();
	}

	private async _findElement(target: T): Promise<T | undefined> {
		const queue: Array<T | undefined> = [undefined];
		const visited = new Set<T>();
		while (queue.length > 0) {
			const current = queue.shift();
			if (current !== undefined) {
				if (current === target) {
					return current;
				}
				if (visited.has(current)) {
					continue;
				}
				visited.add(current);
			}
			const children = await this.getChildren(current);
			for (const child of children) {
				if (child === target) {
					return child;
				}
				queue.push(child);
			}
		}
		return undefined;
	}
}
