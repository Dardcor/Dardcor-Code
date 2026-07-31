/**
 * Dardcor Code - Collapse All Sections Action Inside Sidebar View
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { SidebarViewContainer } from './sidebar-view-container';

export const enum SidebarActionId {
	COLLAPSE_ALL = 'collapseAll',
	EXPAND_ALL = 'expandAll',
	REFRESH = 'refresh',
}

export interface ISidebarActionSpec {
	readonly id: SidebarActionId;
	readonly icon: string;
	readonly title: string;
}

export interface ISidebarActionsOptions {
	readonly container: HTMLElement;
	readonly viewContainer?: SidebarViewContainer;
	readonly actions?: ISidebarActionSpec[];
}

export class SidebarActions extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _viewContainer: SidebarViewContainer | null;
	private readonly _buttons = new Map<string, HTMLElement>();
	private readonly _sectionIds = new Set<string>();
	private readonly _specs = new Map<SidebarActionId, ISidebarActionSpec>();

	private readonly _onDidAction = this._register(new Emitter<ISidebarActionSpec>());
	readonly onDidAction: Event<ISidebarActionSpec> = this._onDidAction.event;

	constructor(options: ISidebarActionsOptions) {
		super();
		this._container = options.container;
		this._viewContainer = options.viewContainer ?? null;
		this._render(options.actions ?? SidebarActions.createDefaultActions());
	}

	get element(): HTMLElement {
		return this._container;
	}

	trackSection(id: string): void {
		this._sectionIds.add(id);
	}

	untrackSection(id: string): void {
		this._sectionIds.delete(id);
	}

	clearSections(): void {
		this._sectionIds.clear();
	}

	getTrackedSections(): string[] {
		return Array.from(this._sectionIds);
	}

	collapseAll(): void {
		if (!this._viewContainer) {
			this._fire(SidebarActionId.COLLAPSE_ALL);
			return;
		}
		for (const id of this._sectionIds) {
			this._viewContainer.collapseSection(id);
		}
		this._fire(SidebarActionId.COLLAPSE_ALL);
	}

	expandAll(): void {
		if (!this._viewContainer) {
			this._fire(SidebarActionId.EXPAND_ALL);
			return;
		}
		for (const id of this._sectionIds) {
			this._viewContainer.expandSection(id);
		}
		this._fire(SidebarActionId.EXPAND_ALL);
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	setActionEnabled(id: SidebarActionId, enabled: boolean): void {
		const btn = this._buttons.get(id);
		if (btn) {
			btn.style.opacity = enabled ? '1' : '0.4';
			btn.style.pointerEvents = enabled ? 'auto' : 'none';
		}
	}

	private _fire(id: SidebarActionId): void {
		const spec = this._specs.get(id);
		if (spec) {
			this._onDidAction.fire(spec);
		}
	}

	private _render(actions: ISidebarActionSpec[]): void {
		this._container.style.display = 'flex';
		this._container.style.alignItems = 'center';
		this._container.style.gap = '2px';
		for (const spec of actions) {
			this._specs.set(spec.id, spec);
			const btn = $<HTMLElement>('span', `dc-sidebar-action dc-sidebar-action-${spec.id}`);
			btn.textContent = spec.icon;
			btn.title = spec.title;
			btn.dataset['actionId'] = spec.id;
			btn.style.cssText = 'cursor:pointer;color:#858585;font-size:12px;padding:2px 4px;border-radius:3px;';
			btn.addEventListener('mouseenter', () => {
				btn.style.background = '#3c3c3c';
			});
			btn.addEventListener('mouseleave', () => {
				btn.style.background = 'transparent';
			});
			btn.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				switch (spec.id) {
					case SidebarActionId.COLLAPSE_ALL:
						this.collapseAll();
						break;
					case SidebarActionId.EXPAND_ALL:
						this.expandAll();
						break;
					case SidebarActionId.REFRESH:
						this._fire(SidebarActionId.REFRESH);
						break;
				}
			});
			this._buttons.set(spec.id, btn);
			this._container.appendChild(btn);
		}
	}

	static createDefaultActions(): ISidebarActionSpec[] {
		return [
			{ id: SidebarActionId.REFRESH, icon: '\u21bb', title: 'Refresh' },
			{ id: SidebarActionId.COLLAPSE_ALL, icon: '\u2302', title: 'Collapse All Sections' },
			{ id: SidebarActionId.EXPAND_ALL, icon: '\u2913', title: 'Expand All Sections' },
		];
	}

	dispose(): void {
		this._buttons.clear();
		this._specs.clear();
		this._sectionIds.clear();
		super.dispose();
	}
}
