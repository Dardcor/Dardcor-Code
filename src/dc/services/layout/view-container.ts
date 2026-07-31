/**
 * Dardcor Code - View Container Registry (Task 183)
 * Mirrors: vs/workbench/common/views.ts (ViewContainerRegistry)
 */

import { Emitter, Event } from '../../core/events/emitter.js';

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

export class ViewContainerRegistry {
	private readonly _containers = new Map<ViewContainerLocation, IViewContainer[]>();
	private readonly _onDidChange = new Emitter<{ location: ViewContainerLocation; container: IViewContainer }>();
	readonly onDidChange = this._onDidChange.event;

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
}

const instance = new ViewContainerRegistry();

export function getViewContainerRegistry(): ViewContainerRegistry {
	return instance;
}
