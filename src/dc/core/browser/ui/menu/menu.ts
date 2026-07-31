import { IAction } from '../../../common/actions.js';

export interface IMenuOptions {
	ariaLabel?: string;
	actions?: IAction[];
}

export class Menu {
	constructor(container: HTMLElement, actions: IAction[], options?: IMenuOptions) {}
}
