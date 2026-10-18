/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWebview } from './webview.js';

export class WebviewWindowDragMonitor extends Disposable {
	constructor(targetWindow: CodeWindow, getWebview: () => IWebview | undefined) {
		super();

		const onDragStart = () => {
			getWebview()?.windowDidDragStart();
		};

		const onDragEnd = () => {
			getWebview()?.windowDidDragEnd();
		};

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_START, () => {
			onDragStart();
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_END, onDragEnd));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.MOUSE_MOVE, currentEvent => {
			if (currentEvent.buttons === 0) {
				onDragEnd();
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG, (event) => {
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart();
			}
		}));

		this._register(DOM.addDisposableListener(targetWindow, DOM.EventType.DRAG_OVER, (event) => {
			if (event.shiftKey) {
				onDragEnd();
			} else {
				onDragStart();
			}
		}));

	}
}
