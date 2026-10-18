/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { IEditorMouseEvent } from '../../../browser/editorBrowser.js';

const enum PADDING {
	VALUE = 3
}

export function isMousePositionWithinElement(element: HTMLElement, posx: number, posy: number): boolean {
	const elementRect = dom.getDomNodePagePosition(element);
	if (posx < elementRect.left + PADDING.VALUE
		|| posx > elementRect.left + elementRect.width - PADDING.VALUE
		|| posy < elementRect.top + PADDING.VALUE
		|| posy > elementRect.top + elementRect.height - PADDING.VALUE) {
		return false;
	}
	return true;
}
export function shouldShowHover(
	hoverEnabled: 'on' | 'off' | 'onKeyboardModifier',
	multiCursorModifier: 'altKey' | 'ctrlKey' | 'metaKey',
	mouseEvent: IEditorMouseEvent
): boolean {
	if (hoverEnabled === 'on') {
		return true;
	}
	if (hoverEnabled === 'off') {
		return false;
	}
	return isTriggerModifierPressed(multiCursorModifier, mouseEvent.event);
}

export function isTriggerModifierPressed(
	multiCursorModifier: 'altKey' | 'ctrlKey' | 'metaKey',
	event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }
): boolean {
	if (multiCursorModifier === 'altKey') {
		return event.ctrlKey || event.metaKey;
	}
	return event.altKey;
}
