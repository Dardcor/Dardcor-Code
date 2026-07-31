/**
 * Dardcor Code - Multi-Monitor Popup Auxiliary Window Manager
 */

import { Disposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';
import { AuxiliaryWindowElement, IAuxiliaryWindowOptions } from './auxiliary-window-element.js';

export class AuxiliaryWindowService extends Disposable {
	private readonly _windows = new Map<string, AuxiliaryWindowElement>();
	private readonly _onDidOpen = this._register(new Emitter<AuxiliaryWindowElement>());
	private readonly _onDidClose = this._register(new Emitter<AuxiliaryWindowElement>());

	readonly onDidOpen: Event<AuxiliaryWindowElement> = this._onDidOpen.event;
	readonly onDidClose: Event<AuxiliaryWindowElement> = this._onDidClose.event;

	openWindow(options: IAuxiliaryWindowOptions): AuxiliaryWindowElement {
		const windowElement = new AuxiliaryWindowElement(options);
		this._register(windowElement);
		windowElement.onDidClose(() => {
			if (this._windows.delete(windowElement.id)) {
				this._onDidClose.fire(windowElement);
			}
		});
		this._windows.set(windowElement.id, windowElement);
		windowElement.open();
		this._onDidOpen.fire(windowElement);
		return windowElement;
	}

	getWindow(id: string): AuxiliaryWindowElement | undefined {
		return this._windows.get(id);
	}

	getWindows(): AuxiliaryWindowElement[] {
		return Array.from(this._windows.values());
	}

	get count(): number {
		return this._windows.size;
	}

	closeAll(): void {
		for (const win of Array.from(this._windows.values())) {
			win.close();
		}
		this._windows.clear();
	}

	dispose(): void {
		this.closeAll();
		super.dispose();
	}
}
