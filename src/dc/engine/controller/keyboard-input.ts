/**
 * Dardcor Code - Hidden Textarea Input Listener for IME Composition (Task 222)
 * Mirrors: vs/editor/browser/controller/textAreaInput.ts
 */

import { Disposable } from '../../core/lifecycle/disposable';
import { addDisposableListener } from '../../core/dom/element';
import { Emitter, Event } from '../../core/events/emitter';

export interface ITextAreaInputData {
	readonly text: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

export class KeyboardInput extends Disposable {
	private _isComposing = false;
	private _lastValue = '';
	private _compositionStartValue = '';

	private readonly _onKeyDown = this._register(new Emitter<KeyboardEvent>());
	readonly onKeyDown: Event<KeyboardEvent> = this._onKeyDown.event;

	private readonly _onKeyUp = this._register(new Emitter<KeyboardEvent>());
	readonly onKeyUp: Event<KeyboardEvent> = this._onKeyUp.event;

	private readonly _onTextInput = this._register(new Emitter<ITextAreaInputData>());
	readonly onTextInput: Event<ITextAreaInputData> = this._onTextInput.event;

	private readonly _onCompositionStart = this._register(new Emitter<void>());
	readonly onCompositionStart: Event<void> = this._onCompositionStart.event;

	private readonly _onCompositionEnd = this._register(new Emitter<ITextAreaInputData>());
	readonly onCompositionEnd: Event<ITextAreaInputData> = this._onCompositionEnd.event;

	private readonly _onPaste = this._register(new Emitter<string>());
	readonly onPaste: Event<string> = this._onPaste.event;

	private readonly _onCut = this._register(new Emitter<string>());
	readonly onCut: Event<string> = this._onCut.event;

	constructor(private readonly _textarea: HTMLTextAreaElement) {
		super();
		this._lastValue = this._textarea.value;
		this._register(addDisposableListener(this._textarea, 'keydown', e => this._onKeyDown.fire(e as KeyboardEvent)));
		this._register(addDisposableListener(this._textarea, 'keyup', e => this._onKeyUp.fire(e as KeyboardEvent)));
		this._register(addDisposableListener(this._textarea, 'compositionstart', () => this._handleCompositionStart()));
		this._register(addDisposableListener(this._textarea, 'compositionupdate', () => { /* intermediate IME state is read on input */ }));
		this._register(addDisposableListener(this._textarea, 'compositionend', () => this._handleCompositionEnd()));
		this._register(addDisposableListener(this._textarea, 'input', () => this._handleInput()));
		this._register(addDisposableListener(this._textarea, 'paste', e => this._handlePaste(e as ClipboardEvent)));
		this._register(addDisposableListener(this._textarea, 'cut', e => this._handleCut(e as ClipboardEvent)));
	}

	isComposing(): boolean {
		return this._isComposing;
	}

	focus(): void {
		this._textarea.focus();
	}

	blur(): void {
		this._textarea.blur();
	}

	setValue(value: string, selectionStart = value.length, selectionEnd = selectionStart): void {
		this._lastValue = value;
		this._textarea.value = value;
		try {
			this._textarea.setSelectionRange(selectionStart, selectionEnd);
		} catch {
			// selection range is invalid when the element is detached
		}
	}

	getValue(): string {
		return this._textarea.value;
	}

	private _handleCompositionStart(): void {
		this._isComposing = true;
		this._compositionStartValue = this._textarea.value;
		this._onCompositionStart.fire();
	}

	private _handleCompositionEnd(): void {
		if (!this._isComposing) {
			return;
		}
		this._isComposing = false;
		const value = this._textarea.value;
		const delta = this._computeDelta(this._compositionStartValue, value);
		if (delta) {
			this._onCompositionEnd.fire(delta);
		}
		this._lastValue = value;
	}

	private _handleInput(): void {
		const value = this._textarea.value;
		const delta = this._computeDelta(this._lastValue, value);
		this._lastValue = value;
		if (delta) {
			if (this._isComposing) {
				// during composition, intermediate updates are ignored;
				// the final text is delivered on compositionend
				return;
			}
			this._onTextInput.fire(delta);
		}
	}

	private _computeDelta(oldValue: string, newValue: string): ITextAreaInputData | null {
		if (oldValue === newValue) {
			return null;
		}
		let prefix = 0;
		const commonLength = Math.min(oldValue.length, newValue.length);
		while (prefix < commonLength && oldValue.charAt(prefix) === newValue.charAt(prefix)) {
			prefix++;
		}
		let suffix = 0;
		while (
			suffix < commonLength - prefix &&
			oldValue.charAt(oldValue.length - 1 - suffix) === newValue.charAt(newValue.length - 1 - suffix)
		) {
			suffix++;
		}
		const inserted = newValue.substring(prefix, newValue.length - suffix);
		return {
			text: inserted,
			startOffset: prefix,
			endOffset: oldValue.length - suffix,
		};
	}

	private _handlePaste(e: ClipboardEvent): void {
		const text = e.clipboardData?.getData('text') ?? '';
		if (text) {
			this._onPaste.fire(text);
		}
	}

	private _handleCut(e: ClipboardEvent): void {
		const text = e.clipboardData?.getData('text') ?? '';
		if (text) {
			this._onCut.fire(text);
		}
	}
}
