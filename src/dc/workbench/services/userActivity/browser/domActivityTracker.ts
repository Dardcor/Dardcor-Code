/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { IUserActivityService } from '../common/userActivityService.js';

const CHECK_INTERVAL = 30_000;

const MIN_INTERVALS_WITHOUT_ACTIVITY = 2;

const eventListenerOptions: AddEventListenerOptions = {
	passive: true,
	capture: true,
};

export class DomActivityTracker extends Disposable {
	constructor(userActivityService: IUserActivityService) {
		super();

		let intervalsWithoutActivity = MIN_INTERVALS_WITHOUT_ACTIVITY;
		const intervalTimer = this._register(new dom.WindowIntervalTimer());
		const activeMutex = this._register(new MutableDisposable());
		activeMutex.value = userActivityService.markActive();

		const onInterval = () => {
			if (++intervalsWithoutActivity === MIN_INTERVALS_WITHOUT_ACTIVITY) {
				activeMutex.clear();
				intervalTimer.cancel();
			}
		};

		const onActivity = (targetWindow: Window & typeof globalThis) => {
			if (intervalsWithoutActivity === MIN_INTERVALS_WITHOUT_ACTIVITY) {
				activeMutex.value = userActivityService.markActive();
				intervalTimer.cancelAndSet(onInterval, CHECK_INTERVAL, targetWindow);
			}

			intervalsWithoutActivity = 0;
		};

		this._register(Event.runAndSubscribe(dom.onDidRegisterWindow, ({ window, disposables }) => {
			disposables.add(dom.addDisposableListener(window.document, 'touchstart', () => onActivity(window), eventListenerOptions));
			disposables.add(dom.addDisposableListener(window.document, 'mousedown', () => onActivity(window), eventListenerOptions));
			disposables.add(dom.addDisposableListener(window.document, 'keydown', () => onActivity(window), eventListenerOptions));
		}, { window: mainWindow, disposables: this._store }));

		onActivity(mainWindow);
	}
}
