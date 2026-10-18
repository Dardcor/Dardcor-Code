/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../common/lifecycle.js';
import type { IHoverDelegate2 } from './hover.js';

let baseHoverDelegate: IHoverDelegate2 = {
	showInstantHover: () => undefined,
	showDelayedHover: () => undefined,
	setupDelayedHover: () => Disposable.None,
	setupDelayedHoverAtMouse: () => Disposable.None,
	hideHover: () => undefined,
	showAndFocusLastHover: () => undefined,
	setupManagedHover: () => ({
		dispose: () => undefined,
		show: () => undefined,
		hide: () => undefined,
		update: () => undefined,
	}),
	showManagedHover: () => undefined
};

export function setBaseLayerHoverDelegate(hoverDelegate: IHoverDelegate2): void {
	baseHoverDelegate = hoverDelegate;
}








export function getBaseLayerHoverDelegate(): IHoverDelegate2 {
	return baseHoverDelegate;
}
