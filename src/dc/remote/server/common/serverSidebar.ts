import { Emitter, Event } from '../../../../dc/core/common/event.js';
import { IDisposable } from '../../../../dc/core/common/lifecycle.js';

export interface IServerSidebarView {
	readonly id: string;
	readonly name: string;
	readonly order?: number;
	readonly canToggleVisibility?: boolean;
	readonly hideByDefault?: boolean;
}

export interface IServerSidebarService {
	readonly onDidViewToggle: Event<{ id: string; visible: boolean }>;
	readonly onDidActiveViewChange: Event<string>;
	getActiveView(): string | undefined;
	setActiveView(id: string): void;
	getViews(): IServerSidebarView[];
	registerView(view: IServerSidebarView): IDisposable;
	isViewVisible(id: string): boolean;
	toggleView(id: string): void;
	showView(id: string, focus?: boolean): void;
	hideView(id: string): void;
	moveView(id: string, toIndex: number): void;
	focusSidebar(): void;
}

export class ServerSidebarCommon implements IServerSidebarService {
	private readonly _views = new Map<string, IServerSidebarView>();
	private readonly _visibleViews = new Set<string>();
	private _activeViewId: string | undefined;

	private readonly _onDidViewToggle = new Emitter<{ id: string; visible: boolean }>();
	readonly onDidViewToggle: Event<{ id: string; visible: boolean }> = this._onDidViewToggle.event;

	private readonly _onDidActiveViewChange = new Emitter<string>();
	readonly onDidActiveViewChange: Event<string> = this._onDidActiveViewChange.event;

	getActiveView(): string | undefined {
		return this._activeViewId;
	}

	setActiveView(id: string): void {
		if (this._views.has(id)) {
			this._activeViewId = id;
			if (!this._visibleViews.has(id)) {
				this._visibleViews.add(id);
				this._onDidViewToggle.fire({ id, visible: true });
			}
			this._onDidActiveViewChange.fire(id);
		}
	}

	getViews(): IServerSidebarView[] {
		return Array.from(this._views.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	}

	registerView(view: IServerSidebarView): IDisposable {
		this._views.set(view.id, view);
		if (!view.hideByDefault) {
			this._visibleViews.add(view.id);
		}
		return { dispose: () => { this._views.delete(view.id); this._visibleViews.delete(view.id); } };
	}

	isViewVisible(id: string): boolean {
		return this._visibleViews.has(id);
	}

	toggleView(id: string): void {
		if (this._visibleViews.has(id)) {
			this.hideView(id);
		} else {
			this.showView(id);
		}
	}

	showView(id: string, focus?: boolean): void {
		if (this._views.has(id)) {
			this._visibleViews.add(id);
			this._onDidViewToggle.fire({ id, visible: true });
			if (focus) {
				this.setActiveView(id);
			}
		}
	}

	hideView(id: string): void {
		if (this._visibleViews.has(id)) {
			this._visibleViews.delete(id);
			this._onDidViewToggle.fire({ id, visible: false });
			if (this._activeViewId === id) {
				this._activeViewId = undefined;
			}
		}
	}

	moveView(id: string, toIndex: number): void {
		const views = this.getViews();
		const idx = views.findIndex(v => v.id === id);
		if (idx >= 0) {
			const [view] = views.splice(idx, 1);
			views.splice(toIndex, 0, view);
			views.forEach((v, i) => { (v as any).order = i; });
		}
	}

	focusSidebar(): void {}
}
