/**
 * Dardcor Code - Activity Bar Viewlet Item Registry
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';

export interface IViewletDescriptor {
	readonly id: string;
	readonly title: string;
	readonly icon: string;
	readonly order: number;
	createView(container: HTMLElement): IDisposable;
}

export class ViewletRegistry extends Disposable {
	private readonly _viewlets = new Map<string, IViewletDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	registerViewlet(descriptor: IViewletDescriptor): IDisposable {
		this._viewlets.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._viewlets.delete(descriptor.id);
				this._onDidChange.fire();
			}
		};
	}

	getViewlet(id: string): IViewletDescriptor | undefined {
		return this._viewlets.get(id);
	}

	getViewlets(): IViewletDescriptor[] {
		return Array.from(this._viewlets.values()).sort((a, b) => a.order - b.order);
	}

	hasViewlet(id: string): boolean {
		return this._viewlets.has(id);
	}

	static readonly instance = new ViewletRegistry();
}
