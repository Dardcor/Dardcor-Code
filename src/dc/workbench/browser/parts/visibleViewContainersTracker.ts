/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap } from '../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../common/views.js';

export class VisibleViewContainersTracker extends Disposable {

	private readonly viewContainerModelListeners = this._register(new DisposableMap<string>());

	private readonly _onDidChange = this._register(new Emitter<{ before: number; after: number }>());
	readonly onDidChange: Event<{ before: number; after: number }> = this._onDidChange.event;

	private _visibleCount: number = 0;

	constructor(
		private readonly location: ViewContainerLocation,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService
	) {
		super();

		this.registerListeners();
		this.initializeViewContainerListeners();
		this.updateVisibleCount();
	}

	get visibleCount(): number {
		return this._visibleCount;
	}

	private registerListeners(): void {
		this._register(this.viewDescriptorService.onDidChangeViewContainers(({ added, removed }) => {
			for (const { container, location } of added) {
				if (location === this.location) {
					this.addViewContainerModelListener(container.id);
				}
			}
			for (const { container, location } of removed) {
				if (location === this.location) {
					this.viewContainerModelListeners.deleteAndDispose(container.id);
				}
			}

			const relevantChange = [...added, ...removed].some(({ location }) => location === this.location);
			if (relevantChange) {
				this.updateVisibleCount();
			}
		}));

		this._register(this.viewDescriptorService.onDidChangeContainerLocation(({ viewContainer, from, to }) => {
			if (from === this.location) {
				this.viewContainerModelListeners.deleteAndDispose(viewContainer.id);
			}
			if (to === this.location) {
				this.addViewContainerModelListener(viewContainer.id);
			}

			if (from === this.location || to === this.location) {
				this.updateVisibleCount();
			}
		}));
	}

	private initializeViewContainerListeners(): void {
		for (const container of this.viewDescriptorService.getViewContainersByLocation(this.location)) {
			this.addViewContainerModelListener(container.id);
		}
	}

	private addViewContainerModelListener(containerId: string): void {
		const container = this.viewDescriptorService.getViewContainerById(containerId);
		if (container) {
			const model = this.viewDescriptorService.getViewContainerModel(container);
			const listener = model.onDidChangeActiveViewDescriptors(() => this.updateVisibleCount());
			this.viewContainerModelListeners.set(containerId, listener);
		}
	}

	private updateVisibleCount(): void {
		const viewContainers = this.viewDescriptorService.getViewContainersByLocation(this.location);
		const visibleViewContainers = viewContainers.filter(container =>
			this.viewDescriptorService.getViewContainerModel(container).activeViewDescriptors.length > 0
		);

		const newCount = visibleViewContainers.length;
		if (this._visibleCount !== newCount) {
			const before = this._visibleCount;
			this._visibleCount = newCount;
			this._onDidChange.fire({ before, after: newCount });
		}
	}
}
