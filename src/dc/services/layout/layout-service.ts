/**
 * Dardcor Code - Layout Service (Task 155)
 * Mirrors: vs/workbench/services/layout/browser/layoutService.ts
 */

import { IDisposable } from '../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../core/events/emitter.js';

export const enum Parts {
	TITLEBAR_PART = 'workbench.parts.titlebar',
	ACTIVITYBAR_PART = 'workbench.parts.activitybar',
	SIDEBAR_PART = 'workbench.parts.sidebar',
	EDITOR_PART = 'workbench.parts.editor',
	PANEL_PART = 'workbench.parts.panel',
	STATUSBAR_PART = 'workbench.parts.statusbar',
}

export interface ILayoutService extends IDisposable {
	readonly onDidLayout: Event<{ width: number; height: number }>;
	readonly onDidChangePartVisibility: Event<{ part: Parts; visible: boolean }>;
	isVisible(part: Parts): boolean;
	setPartHidden(hidden: boolean, part: Parts): void;
	getContainer(part: Parts): HTMLElement | undefined;
}

export class LayoutService implements ILayoutService {
	private readonly _visibility = new Map<Parts, boolean>();
	private readonly _containers = new Map<Parts, HTMLElement>();
	private readonly _onDidLayout = new Emitter<{ width: number; height: number }>();
	private readonly _onDidChangePartVisibility = new Emitter<{ part: Parts; visible: boolean }>();

	readonly onDidLayout = this._onDidLayout.event;
	readonly onDidChangePartVisibility = this._onDidChangePartVisibility.event;

	constructor() {
		this._visibility.set(Parts.TITLEBAR_PART, true);
		this._visibility.set(Parts.ACTIVITYBAR_PART, true);
		this._visibility.set(Parts.SIDEBAR_PART, true);
		this._visibility.set(Parts.EDITOR_PART, true);
		this._visibility.set(Parts.PANEL_PART, false);
		this._visibility.set(Parts.STATUSBAR_PART, true);
	}

	isVisible(part: Parts): boolean {
		return this._visibility.get(part) ?? true;
	}

	setPartHidden(hidden: boolean, part: Parts): void {
		if (this.isVisible(part) === !hidden) return;
		this._visibility.set(part, !hidden);
		const container = this._containers.get(part);
		if (container) {
			container.style.display = hidden ? 'none' : '';
		}
		this._onDidChangePartVisibility.fire({ part, visible: !hidden });
	}

	registerContainer(part: Parts, container: HTMLElement): void {
		this._containers.set(part, container);
		container.style.display = this.isVisible(part) ? '' : 'none';
	}

	getContainer(part: Parts): HTMLElement | undefined {
		return this._containers.get(part);
	}

	layout(width: number, height: number): void {
		this._onDidLayout.fire({ width, height });
	}

	dispose(): void {
		this._onDidLayout.dispose();
		this._onDidChangePartVisibility.dispose();
	}
}
