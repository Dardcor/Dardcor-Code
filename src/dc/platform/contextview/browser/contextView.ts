/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextMenuDelegate } from '../../../base/browser/contextmenu.js';
import { StandardMouseEvent } from '../../../base/browser/mouseEvent.js';
import { AnchorAlignment, AnchorAxisAlignment, IAnchor, IContextViewCloseAnimation, IContextViewProvider } from '../../../base/browser/ui/contextview/contextview.js';
import { IAction } from '../../../base/common/actions.js';
import { Event } from '../../../base/common/event.js';
import { AnchorPosition } from '../../../base/common/layout.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IMenuActionOptions, MenuId } from '../../actions/common/actions.js';
import { IContextKeyService } from '../../contextkey/common/contextkey.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';

export const IContextViewService = createDecorator<IContextViewService>('contextViewService');

export interface IContextViewService extends IContextViewProvider {

	readonly _serviceBrand: undefined;

	showContextView(delegate: IContextViewDelegate, container?: HTMLElement, shadowRoot?: boolean): IOpenContextView;
	hideContextView(data?: any): void;
	getContextViewElement(): HTMLElement;
	layout(): void;
	anchorAlignment?: AnchorAlignment;
}

export interface IContextViewDelegate {

	canRelayout?: boolean;

	getAnchor(): HTMLElement | StandardMouseEvent | IAnchor;
	render(container: HTMLElement): IDisposable;
	onDOMEvent?(e: any, activeElement: HTMLElement): void;
	onHide?(data?: any): void;
	closeAnimation?: IContextViewCloseAnimation;
	focus?(): void;
	anchorAlignment?: AnchorAlignment;
	anchorAxisAlignment?: AnchorAxisAlignment;
	anchorPosition?: AnchorPosition;
	preventAvoid?: boolean;

	layer?: number;
}

export interface IOpenContextView {
	close: () => void;
}

export const IContextMenuService = createDecorator<IContextMenuService>('contextMenuService');

export interface IContextMenuService {

	readonly _serviceBrand: undefined;

	readonly onDidShowContextMenu: Event<void>;
	readonly onDidHideContextMenu: Event<void>;

	showContextMenu(delegate: IContextMenuDelegate | IContextMenuMenuDelegate): void;
}

export type IContextMenuMenuDelegate = {
	menuId?: MenuId;
	menuActionOptions?: IMenuActionOptions;
	contextKeyService?: IContextKeyService;

	getActions?(): IAction[];
} & Omit<IContextMenuDelegate, 'getActions'>;
