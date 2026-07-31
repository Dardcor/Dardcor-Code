/**
 * Dardcor Code - Viewlet Toggle Button Action
 */

import { Disposable } from '../../../core/lifecycle/disposable';
import { Emitter, Event } from '../../../core/events/emitter';
import { $ } from '../../../core/dom/element';
import { IViewletDescriptor } from '../sidebar/viewlet-registry';

export class ActivityAction extends Disposable {
	private readonly _el: HTMLButtonElement;
	private _active = false;
	private readonly _onDidClick = this._register(new Emitter<ActivityAction>());
	readonly onDidClick: Event<ActivityAction> = this._onDidClick.event;

	constructor(
		private readonly _descriptor: IViewletDescriptor,
		parent: HTMLElement
	) {
		super();
		this._el = $<HTMLButtonElement>('button', 'dc-activity-action');
		this._el.type = 'button';
		this._el.title = _descriptor.title;
		this._el.style.cssText = 'position:relative;width:48px;height:48px;border:none;background:transparent;color:#858585;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;outline:none;';
		const icon = $<HTMLElement>('span', 'dc-activity-action-icon');
		icon.textContent = _descriptor.icon;
		this._el.appendChild(icon);
		this._el.addEventListener('click', (e: MouseEvent) => {
			e.stopPropagation();
			this._onDidClick.fire(this);
		});
		parent.appendChild(this._el);
	}

	get descriptor(): IViewletDescriptor {
		return this._descriptor;
	}

	get element(): HTMLButtonElement {
		return this._el;
	}

	get isActive(): boolean {
		return this._active;
	}

	setActive(active: boolean): void {
		this._active = active;
		this._el.style.color = active ? '#ffffff' : '#858585';
		this._el.style.borderLeft = active ? '2px solid #ffffff' : '2px solid transparent';
		this._el.style.paddingLeft = active ? '0' : '0';
	}

	dispose(): void {
		this._el.remove();
		super.dispose();
	}
}
