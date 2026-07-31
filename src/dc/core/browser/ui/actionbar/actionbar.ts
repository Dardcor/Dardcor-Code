import { Disposable } from '../../../common/lifecycle.js';
import { IAction } from '../../../common/actions.js';

export interface IActionViewItemOptions {
	icon?: boolean;
	label?: boolean;
	keybinding?: string;
}

export interface IActionViewItemProvider {
	(action: IAction, options: IActionViewItemOptions): ActionViewItem | undefined;
}

export class ActionViewItem extends Disposable {
	public domNode: HTMLElement;

	constructor(context: any, action: IAction, options?: IActionViewItemOptions) {
		super();
		this.domNode = document.createElement('div');
		this.domNode.className = 'action-item';
	}
}

export class ActionBar extends Disposable {
	public domNode: HTMLElement;
	private _actions: IAction[] = [];

	constructor(container: HTMLElement, options?: { actionViewItemProvider?: IActionViewItemProvider; orientation?: number }) {
		super();
		this.domNode = document.createElement('div');
		this.domNode.className = 'monaco-action-bar';
		if (container) {
			container.appendChild(this.domNode);
		}
	}

	public push(action: IAction | IAction[], options?: IActionViewItemOptions): void {
		const actions = Array.isArray(action) ? action : [action];
		for (const act of actions) {
			this._actions.push(act);
		}
	}

	public clear(): void {
		this._actions = [];
		this.domNode.innerHTML = '';
	}

	public getActions(): IAction[] {
		return this._actions;
	}
}
