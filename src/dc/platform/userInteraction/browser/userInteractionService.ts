/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constObservable, IObservable, IReader } from '../../../base/common/observable.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Emitter } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IFocusTracker } from '../../../base/browser/dom.js';

export const IUserInteractionService = createDecorator<IUserInteractionService>('userInteractionService');

export interface IModifierKeyStatus {
	readonly ctrlKey: boolean;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
}

export interface IUserInteractionService {
	readonly _serviceBrand: undefined;

	readModifierKeyStatus(element: HTMLElement | Window, reader: IReader | undefined): IModifierKeyStatus;

	createFocusTracker(element: HTMLElement | Window, store: DisposableStore): IObservable<boolean>;

	createHoverTracker(element: Element, store: DisposableStore): IObservable<boolean>;

	createDomFocusTracker(element: HTMLElement): IFocusTracker;
}

export class MockUserInteractionService implements IUserInteractionService {
	readonly _serviceBrand: undefined;

	constructor(
		private readonly _simulateFocus: boolean = true,
		private readonly _simulateHover: boolean = false,
		private readonly _modifiers: IModifierKeyStatus = { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }
	) { }

	readModifierKeyStatus(_element: HTMLElement | Window, _reader: IReader | undefined): IModifierKeyStatus {
		return this._modifiers;
	}

	createFocusTracker(_element: HTMLElement | Window, _store: DisposableStore): IObservable<boolean> {
		return constObservable(this._simulateFocus);
	}

	createHoverTracker(_element: Element, _store: DisposableStore): IObservable<boolean> {
		return constObservable(this._simulateHover);
	}

	createDomFocusTracker(_element: HTMLElement): IFocusTracker {
		const tracker = new class extends Disposable implements IFocusTracker {
			private readonly _onDidFocus = this._register(new Emitter<void>());
			readonly onDidFocus = this._onDidFocus.event;
			private readonly _onDidBlur = this._register(new Emitter<void>());
			readonly onDidBlur = this._onDidBlur.event;
			refreshState(): void { }
			fireFocus(): void { this._onDidFocus.fire(); }
		};
		if (this._simulateFocus) {
			queueMicrotask(() => tracker.fireFocus());
		}
		return tracker;
	}
}
