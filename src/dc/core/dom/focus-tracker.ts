/**
 * Dardcor Code - Container Focus Tracker Controller
 */

import { Disposable } from '../lifecycle/disposable';
import { Emitter, Event } from '../events/emitter';
import { addDisposableListener } from './element';

export class FocusTracker extends Disposable {
	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus: Event<void> = this._onDidFocus.event;

	private readonly _onDidBlur = this._register(new Emitter<void>());
	readonly onDidBlur: Event<void> = this._onDidBlur.event;

	private _hasFocus = false;

	constructor(element: HTMLElement) {
		super();
		this._hasFocus = element.contains(document.activeElement);

		this._register(addDisposableListener(element, 'focus', () => {
			if (!this._hasFocus) {
				this._hasFocus = true;
				this._onDidFocus.fire();
			}
		}, true));

		this._register(addDisposableListener(element, 'blur', () => {
			if (this._hasFocus) {
				this._hasFocus = false;
				this._onDidBlur.fire();
			}
		}, true));
	}

	public hasFocus(): boolean {
		return this._hasFocus;
	}
}
