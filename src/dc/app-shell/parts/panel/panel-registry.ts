/**
 * Dardcor Code - Bottom Panel Tab Item Registry
 */

import { Disposable, IDisposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';

export interface IPanelDescriptor {
	readonly id: string;
	readonly title: string;
	readonly icon: string;
	readonly order: number;
	createView(container: HTMLElement): IDisposable;
}

export class PanelRegistry extends Disposable {
	private readonly _panels = new Map<string, IPanelDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	registerPanel(descriptor: IPanelDescriptor): IDisposable {
		this._panels.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return {
			dispose: () => {
				this._panels.delete(descriptor.id);
				this._onDidChange.fire();
			}
		};
	}

	getPanel(id: string): IPanelDescriptor | undefined {
		return this._panels.get(id);
	}

	getPanels(): IPanelDescriptor[] {
		return Array.from(this._panels.values()).sort((a, b) => a.order - b.order);
	}

	hasPanel(id: string): boolean {
		return this._panels.has(id);
	}

	static readonly instance = new PanelRegistry();
}
