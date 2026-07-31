/**
 * Dardcor Code - Sidebar View Section Toolbar & Action Buttons Header
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $, clearNode } from '../../../core/dom/element';

export interface IViewHeaderAction {
	readonly id: string;
	readonly icon: string;
	readonly title?: string;
	readonly onClick?: () => void;
	readonly visible?: boolean;
}

export interface IViewHeaderOptions {
	readonly title?: string;
	readonly showCollapse?: boolean;
	readonly uppercase?: boolean;
}

export class ViewHeader extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _titleEl: HTMLElement;
	private readonly _actionsEl: HTMLElement;
	private readonly _collapseEl: HTMLElement | null;
	private readonly _actions = new Map<string, HTMLElement>();
	private _uppercase: boolean;

	private readonly _onDidAction = this._register(new Emitter<string>());
	readonly onDidAction: Event<string> = this._onDidAction.event;

	private readonly _onDidCollapse = this._register(new Emitter<void>());
	readonly onDidCollapse: Event<void> = this._onDidCollapse.event;

	constructor(
		parent: HTMLElement,
		options: IViewHeaderOptions = {}
	) {
		super();
		this._uppercase = options.uppercase ?? true;

		this._container = $<HTMLElement>('div', 'dc-view-header');
		this._container.style.cssText = 'height:35px;background:#252526;display:flex;align-items:center;padding:0 8px 0 12px;user-select:none;flex-shrink:0;gap:2px;border-bottom:1px solid #1e1e1e;';

		this._titleEl = $<HTMLElement>('span', 'dc-view-header-title');
		this._titleEl.style.cssText = 'flex:1;font-size:11px;font-weight:600;letter-spacing:1px;color:#bbbbbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		this._container.appendChild(this._titleEl);

		this._actionsEl = $<HTMLElement>('div', 'dc-view-header-actions');
		this._actionsEl.style.cssText = 'display:flex;align-items:center;gap:2px;';
		this._container.appendChild(this._actionsEl);

		if (options.showCollapse) {
			this._collapseEl = $<HTMLElement>('span', 'dc-view-header-collapse');
			this._collapseEl.textContent = '\u203a';
			this._collapseEl.title = 'Collapse';
			this._collapseEl.style.cssText = 'cursor:pointer;color:#858585;font-size:16px;padding:0 4px;border-radius:3px;';
			this._collapseEl.addEventListener('click', () => this._onDidCollapse.fire());
			this._actionsEl.appendChild(this._collapseEl);
		} else {
			this._collapseEl = null;
		}

		parent.appendChild(this._container);
		if (options.title !== undefined) {
			this.setTitle(options.title);
		}
	}

	get element(): HTMLElement {
		return this._container;
	}

	get title(): string {
		return this._titleEl.textContent ?? '';
	}

	setTitle(title: string): void {
		this._titleEl.textContent = this._uppercase ? title.toUpperCase() : title;
	}

	setActions(actions: IViewHeaderAction[]): void {
		this.clearActions();
		for (const action of actions) {
			this.addAction(action);
		}
	}

	addAction(action: IViewHeaderAction): void {
		if (this._actions.has(action.id)) {
			return;
		}
		const btn = $<HTMLElement>('span', 'dc-view-header-action');
		btn.textContent = action.icon;
		btn.title = action.title ?? action.id;
		btn.dataset['actionId'] = action.id;
		btn.style.cssText = 'cursor:pointer;color:#858585;font-size:14px;padding:2px 4px;border-radius:3px;';
		if (action.visible === false) {
			btn.style.display = 'none';
		}
		btn.addEventListener('mouseenter', () => {
			btn.style.background = '#3c3c3c';
		});
		btn.addEventListener('mouseleave', () => {
			btn.style.background = 'transparent';
		});
		btn.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			action.onClick?.();
			this._onDidAction.fire(action.id);
		});
		this._actions.set(action.id, btn);
		this._actionsEl.appendChild(btn);
	}

	removeAction(id: string): void {
		const btn = this._actions.get(id);
		if (!btn) {
			return;
		}
		btn.remove();
		this._actions.delete(id);
	}

	setActionVisible(id: string, visible: boolean): void {
		const btn = this._actions.get(id);
		if (btn) {
			btn.style.display = visible ? 'block' : 'none';
		}
	}

	clearActions(): void {
		clearNode(this._actionsEl);
		this._actions.clear();
		if (this._collapseEl) {
			this._actionsEl.appendChild(this._collapseEl);
		}
	}

	setVisible(visible: boolean): void {
		this._container.style.display = visible ? 'flex' : 'none';
	}

	dispose(): void {
		this._container.remove();
		super.dispose();
	}
}
