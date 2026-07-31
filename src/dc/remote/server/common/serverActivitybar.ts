import { IDisposable } from 'dc/core/common/lifecycle';
import { Emitter, Event } from 'dc/core/common/event';

export interface IServerActivitybarItem {
	readonly id: string;
	readonly name: string;
	readonly iconUrl?: string;
	readonly iconClass?: string;
	readonly order?: number;
	readonly visible?: boolean;
}

export interface IServerActivitybarBadge {
	readonly count: number;
	readonly tooltip?: string;
}

export interface IServerActivitybarService {
	readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }>;
	readonly onDidChangeActiveItem: Event<string>;
	readonly onDidChangeBadge: Event<{ id: string; badge?: IServerActivitybarBadge }>;

	getItems(): IServerActivitybarItem[];
	getActiveItem(): string | undefined;
	setActiveItem(id: string): void;
	showItem(id: string): void;
	hideItem(id: string): void;
	addItem(item: IServerActivitybarItem): IDisposable;
	removeItem(id: string): void;
	setBadge(id: string, badge: IServerActivitybarBadge | undefined): void;
	getBadge(id: string): IServerActivitybarBadge | undefined;
	getVisibleItems(): IServerActivitybarItem[];
	moveItem(id: string, toIndex: number): void;
	pinItem(id: string): void;
	unpinItem(id: string): void;
	isPinned(id: string): boolean;
	focusActivityBar(): void;
}

export class ServerActivitybarCommon implements IServerActivitybarService {
	private readonly _items = new Map<string, IServerActivitybarItem>();
	private readonly _badges = new Map<string, IServerActivitybarBadge>();
	private readonly _pinnedItems = new Set<string>();
	private _activeItemId: string | undefined;

	private readonly _onDidChangeVisibility = new Emitter<{ id: string; visible: boolean }>();
	readonly onDidChangeVisibility: Event<{ id: string; visible: boolean }> = this._onDidChangeVisibility.event;

	private readonly _onDidChangeActiveItem = new Emitter<string>();
	readonly onDidChangeActiveItem: Event<string> = this._onDidChangeActiveItem.event;

	private readonly _onDidChangeBadge = new Emitter<{ id: string; badge?: IServerActivitybarBadge }>();
	readonly onDidChangeBadge: Event<{ id: string; badge?: IServerActivitybarBadge }> = this._onDidChangeBadge.event;

	getItems(): IServerActivitybarItem[] {
		return Array.from(this._items.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	getActiveItem(): string | undefined {
		return this._activeItemId;
	}

	setActiveItem(id: string): void {
		if (this._items.has(id)) {
			this._activeItemId = id;
			this._onDidChangeActiveItem.fire(id);
		}
	}

	showItem(id: string): void {
		const item = this._items.get(id);
		if (item) {
			(item as any).visible = true;
			this._onDidChangeVisibility.fire({ id, visible: true });
		}
	}

	hideItem(id: string): void {
		const item = this._items.get(id);
		if (item) {
			(item as any).visible = false;
			this._onDidChangeVisibility.fire({ id, visible: false });
		}
	}

	addItem(item: IServerActivitybarItem): IDisposable {
		this._items.set(item.id, item);
		this._pinnedItems.add(item.id);
		return { dispose: () => this.removeItem(item.id) };
	}

	removeItem(id: string): void {
		this._items.delete(id);
		this._badges.delete(id);
		this._pinnedItems.delete(id);
		if (this._activeItemId === id) {
			this._activeItemId = undefined;
		}
	}

	setBadge(id: string, badge: IServerActivitybarBadge | undefined): void {
		if (badge) {
			this._badges.set(id, badge);
		} else {
			this._badges.delete(id);
		}
		this._onDidChangeBadge.fire({ id, badge });
	}

	getBadge(id: string): IServerActivitybarBadge | undefined {
		return this._badges.get(id);
	}

	getVisibleItems(): IServerActivitybarItem[] {
		return this.getItems().filter(i => i.visible !== false);
	}

	moveItem(id: string, toIndex: number): void {
		const items = this.getItems();
		const fromIndex = items.findIndex(i => i.id === id);
		if (fromIndex >= 0 && fromIndex !== toIndex) {
			const [item] = items.splice(fromIndex, 1);
			items.splice(toIndex, 0, item);
			items.forEach((it, idx) => { (it as any).order = idx; });
		}
	}

	pinItem(id: string): void {
		this._pinnedItems.add(id);
	}

	unpinItem(id: string): void {
		this._pinnedItems.delete(id);
	}

	isPinned(id: string): boolean {
		return this._pinnedItems.has(id);
	}

	focusActivityBar(): void {}
}
