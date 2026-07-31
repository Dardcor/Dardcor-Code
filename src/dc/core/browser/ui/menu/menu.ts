import { IAction } from '../../../common/actions';

export interface IMenuOptions {
	ariaLabel?: string;
	actions?: IAction[];
	context?: any;
	actionViewItemProvider?: any;
	getKeyBinding?: (action: IAction) => any;
	actionRunner?: any;
	anchorAlignment?: number;
}

export class Menu {
	constructor(container: HTMLElement, actions: IAction[], options?: IMenuOptions) {}
}
