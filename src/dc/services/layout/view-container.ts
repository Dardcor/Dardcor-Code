/**
 * Dardcor Code - Dockable Panel View Container Registry (Task 183)
 * Mirrors: vs/workbench/common/views.ts (ViewContainerRegistry)
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { Emitter, Event } from '../../core/events/emitter';

export const enum ViewContainerLocation {
	Sidebar = 0,
	Panel = 1,
	AuxiliaryBar = 2,
}

export interface IViewContainer {
	readonly id: string;
	readonly title: string;
	readonly icon?: string;
	readonly order?: number;
}

export interface IViewDescriptor {
	readonly id: string;
	readonly title: string;
	readonly containerId: string;
	readonly order?: number;
	readonly when?: string;
}

export interface IViewChangeEvent {
	readonly location: ViewContainerLocation;
	readonly container: IViewContainer;
}

export class ViewContainerRegistry extends Disposable {
	private readonly _containers = new Map<ViewContainerLocation, IViewContainer[]>();
	private readonly _views = new Map<string, IViewDescriptor[]>();
	private readonly _onDidChange = this._register(new Emitter<IViewChangeEvent>());
	private readonly _onDidChangeViews = this._register(new Emitter<IViewDescriptor>());

	readonly onDidChange: Event<IViewChangeEvent> = this._onDidChange.event;
	readonly onDidChangeViews: Event<IViewDescriptor> = this._onDidChangeViews.event;

	registerViewContainer(location: ViewContainerLocation, container: IViewContainer): void {
		let list = this._containers.get(location);
		if (!list) {
			list = [];
			this._containers.set(location, list);
		}
		list.push(container);
		list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		this._onDidChange.fire({ location, container });
	}

	getViewContainers(location: ViewContainerLocation): IViewContainer[] {
		return [...(this._containers.get(location) ?? [])];
	}

	getContainer(containerId: string): IViewContainer | undefined {
		for (const list of this._containers.values()) {
			const found = list.find((c) => c.id === containerId);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	registerView(view: IViewDescriptor): void {
		let list = this._views.get(view.containerId);
		if (!list) {
			list = [];
			this._views.set(view.containerId, list);
		}
		list.push(view);
		list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		this._onDidChangeViews.fire(view);
	}

	getViews(containerId: string): IViewDescriptor[] {
		return [...(this._views.get(containerId) ?? [])];
	}
}

const instance = new ViewContainerRegistry();

export function getViewContainerRegistry(): ViewContainerRegistry {
	return instance;
}
