/**
 * Dardcor Code - Left Vertical Activity Viewlet Switcher Bar
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { ViewletRegistry, IViewletDescriptor } from '../sidebar/viewlet-registry';
import { ActivityAction } from './activity-action';

export class ActivitybarPart extends Disposable {
	private readonly _container: HTMLElement;
	private readonly _actionsContainer: HTMLElement;
	private readonly _bottomContainer: HTMLElement;
	private readonly _actions = new Map<string, ActivityAction>();
	private _activeViewletId: string | null = null;

	private readonly _onDidChangeActiveViewlet = this._register(new Emitter<IViewletDescriptor>());
	readonly onDidChangeActiveViewlet: Event<IViewletDescriptor> = this._onDidChangeActiveViewlet.event;

	constructor(
		container: HTMLElement,
		private readonly _registry: ViewletRegistry = ViewletRegistry.instance
	) {
		super();
		this._container = container;
		container.style.cssText = 'display:flex;flex-direction:column;align-items:center;padding:0;';

		this._actionsContainer = $<HTMLElement>('div', 'dc-activitybar-actions');
		this._actionsContainer.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
		this._bottomContainer = $<HTMLElement>('div', 'dc-activitybar-bottom');
		this._bottomContainer.style.cssText = 'margin-top:auto;display:flex;flex-direction:column;align-items:center;padding-bottom:6px;';

		container.appendChild(this._actionsContainer);
		container.appendChild(this._bottomContainer);

		this._register(this._registry.onDidChange(() => this._renderActions()));
		this._renderActions();
		this._renderGlobalActions();
	}

	get activeViewletId(): string | null {
		return this._activeViewletId;
	}

	showViewlet(id: string): void {
		const descriptor = this._registry.getViewlet(id);
		if (!descriptor) {
			return;
		}
		this._activeViewletId = id;
		for (const [viewletId, action] of this._actions) {
			action.setActive(viewletId === id);
		}
		this._onDidChangeActiveViewlet.fire(descriptor);
	}

	clearActive(): void {
		this._activeViewletId = null;
		for (const action of this._actions.values()) {
			action.setActive(false);
		}
	}

	private _renderActions(): void {
		for (const action of this._actions.values()) {
			action.dispose();
		}
		this._actions.clear();

		for (const descriptor of this._registry.getViewlets()) {
			const action = new ActivityAction(descriptor, this._actionsContainer);
			this._register(action);
			action.setActive(descriptor.id === this._activeViewletId);
			action.onDidClick(() => {
				if (this._activeViewletId === descriptor.id) {
					this.clearActive();
					this._onDidChangeActiveViewlet.fire(descriptor);
				} else {
					this.showViewlet(descriptor.id);
				}
			});
			this._actions.set(descriptor.id, action);
		}
	}

	private _renderGlobalActions(): void {
		const actions: { icon: string; title: string; onClick?: () => void }[] = [
			{ icon: '\u2699', title: 'Manage (Settings)' },
			{ icon: '\u263a', title: 'Accounts' },
		];
		for (const entry of actions) {
			const btn = $<HTMLButtonElement>('button', 'dc-activitybar-global-action');
			btn.type = 'button';
			btn.title = entry.title;
			btn.style.cssText = 'width:48px;height:42px;border:none;background:transparent;color:#858585;cursor:pointer;font-size:18px;display:flex;align-items:center;justify-content:center;outline:none;';
			const icon = $<HTMLElement>('span');
			icon.textContent = entry.icon;
			btn.appendChild(icon);
			btn.addEventListener('click', () => entry.onClick?.());
			this._bottomContainer.appendChild(btn);
		}
	}
}
