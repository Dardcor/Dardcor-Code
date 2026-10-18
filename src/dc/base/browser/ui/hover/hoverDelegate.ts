/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IHoverPositionOptions, IHoverWidget, IManagedHoverContentOrFactory, IManagedHoverOptions } from './hover.js';
import { HoverPosition } from './hoverWidget.js';
import { IMarkdownString } from '../../../common/htmlContent.js';
import { IDisposable } from '../../../common/lifecycle.js';

export interface IHoverDelegateTarget extends IDisposable {
	readonly targetElements: readonly HTMLElement[];
	x?: number;
}

export interface IHoverDelegateOptions extends IManagedHoverOptions {
	content: IMarkdownString | string | HTMLElement;
	target: IHoverDelegateTarget | HTMLElement;
	container?: HTMLElement;
	position?: Pick<IHoverPositionOptions, 'anchorAlignment'> & {
		hoverPosition?: HoverPosition;
	};
	appearance?: {
		showPointer?: boolean;
		showHoverHint?: boolean;
		skipFadeInAnimation?: boolean;
	};
}

export interface IHoverDelegate {
	showHover(options: IHoverDelegateOptions, focus?: boolean): IHoverWidget | undefined;
	onDidHideHover?: () => void;
	delay: number | ((content?: IManagedHoverContentOrFactory) => number);
	placement?: 'mouse' | 'element';
	showNativeHover?: boolean;
}

export interface IScopedHoverDelegate extends IHoverDelegate, IDisposable { }
