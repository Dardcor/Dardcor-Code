/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHoverDelegate, IScopedHoverDelegate } from './hoverDelegate.js';
import { Lazy } from '../../../common/lazy.js';

const nullHoverDelegateFactory = () => ({
	get delay(): number { return -1; },
	dispose: () => { },
	showHover: () => { return undefined; },
});

let hoverDelegateFactory: (placement: 'mouse' | 'element', enableInstantHover: boolean) => IScopedHoverDelegate = nullHoverDelegateFactory;
const defaultHoverDelegateMouse = new Lazy<IHoverDelegate>(() => hoverDelegateFactory('mouse', false));
const defaultHoverDelegateElement = new Lazy<IHoverDelegate>(() => hoverDelegateFactory('element', false));

export function setHoverDelegateFactory(hoverDelegateProvider: ((placement: 'mouse' | 'element', enableInstantHover: boolean) => IScopedHoverDelegate)): void {
	hoverDelegateFactory = hoverDelegateProvider;
}

export function getDefaultHoverDelegate(placement: 'mouse' | 'element'): IHoverDelegate {
	if (placement === 'element') {
		return defaultHoverDelegateElement.value;
	}
	return defaultHoverDelegateMouse.value;
}

export function createInstantHoverDelegate(): IScopedHoverDelegate {
	return hoverDelegateFactory('element', true);
}
