import { IDisposable } from '../../../common/lifecycle.js';

export enum AnchorAlignment {
	LEFT = 0,
	RIGHT = 1
}

export enum AnchorPosition {
	BELOW = 0,
	ABOVE = 1
}

export interface IContextViewDelegate {
	getAnchor(): HTMLElement | { x: number; y: number };
	render(container: HTMLElement): IDisposable | null;
	onDOMEvent?(e: Event, activeElement: HTMLElement): void;
	onHide?(data?: any): void;
	focus?(): void;
	anchorAlignment?: AnchorAlignment;
	anchorPosition?: AnchorPosition;
}

export interface IContextViewProvider {
	showContextView(delegate: IContextViewDelegate, container?: HTMLElement): void;
	hideContextView(): void;
}

export interface IContextViewCloseAnimation {
	readonly duration?: number;
}

export const CONTEXT_VIEW_MENU_MOTION_CLASS = 'context-view-menu-motion';
export const contextViewMenuCloseAnimation: IContextViewCloseAnimation = { duration: 150 };

export class ContextView implements IContextViewProvider {
	showContextView(delegate: IContextViewDelegate, container?: HTMLElement): void {}
	hideContextView(): void {}
}
