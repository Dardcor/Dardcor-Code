import { Emitter, Event } from 'dc/core/common/event';
import { IDisposable } from 'dc/core/common/lifecycle';

export class ExtHostWindow {
	private _state = { focused: true };
	
	private readonly _onDidChangeWindowState = new Emitter<{ focused: boolean }>();
	readonly onDidChangeWindowState = this._onDidChangeWindowState.event;

	get state() {
		return this._state;
	}

	$onDidChangeWindowFocus(focused: boolean): void {
		if (this._state.focused !== focused) {
			this._state.focused = focused;
			this._onDidChangeWindowState.fire(this._state);
		}
	}
}
