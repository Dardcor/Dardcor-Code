/**
 * Dardcor Code - Tab Usage History Tracker For Ctrl+Tab Switcher
 */

import { Disposable } from '../../../core/lifecycle/disposable.js';
import { Emitter, Event } from '../../../core/events/emitter.js';
import { EditorInput } from './editor-input.js';

export class EditorHistoryTracker extends Disposable {
	private readonly _mru: EditorInput[] = [];
	private _active: EditorInput | null = null;
	private _lastActiveBeforeSwitch: EditorInput | null = null;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	add(input: EditorInput): void {
		const idx = this._mru.indexOf(input);
		if (idx === -1) {
			this._mru.push(input);
		}
	}

	remove(input: EditorInput): void {
		const idx = this._mru.indexOf(input);
		if (idx !== -1) {
			this._mru.splice(idx, 1);
		}
		if (this._active === input) {
			this._active = null;
		}
		if (this._lastActiveBeforeSwitch === input) {
			this._lastActiveBeforeSwitch = null;
		}
		this._onDidChange.fire();
	}

	setActive(input: EditorInput): void {
		if (this._active && this._active !== input) {
			this._lastActiveBeforeSwitch = this._active;
		}
		this._active = input;
		const idx = this._mru.indexOf(input);
		if (idx !== -1) {
			this._mru.splice(idx, 1);
			this._mru.push(input);
		}
		this._onDidChange.fire();
	}

	getActive(): EditorInput | null {
		return this._active;
	}

	getNext(): EditorInput | null {
		if (this._mru.length === 0) {
			return null;
		}
		return this._mru[this._mru.length - 1];
	}

	getPrevious(): EditorInput | null {
		return this._lastActiveBeforeSwitch;
	}

	getMruList(): EditorInput[] {
		return [...this._mru];
	}

	get size(): number {
		return this._mru.length;
	}

	clear(): void {
		this._mru.length = 0;
		this._active = null;
		this._lastActiveBeforeSwitch = null;
		this._onDidChange.fire();
	}
}
