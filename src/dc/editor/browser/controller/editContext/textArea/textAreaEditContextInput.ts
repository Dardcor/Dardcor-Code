/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as browser from '../../../../../base/browser/browser.js';
import * as dom from '../../../../../base/browser/dom.js';
import { DomEmitter } from '../../../../../base/browser/event.js';
import { IKeyboardEvent, StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { inputLatency } from '../../../../../base/browser/performance.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { Disposable, IDisposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import * as strings from '../../../../../base/common/strings.js';
import { Position } from '../../../../common/core/position.js';
import { Selection } from '../../../../common/core/selection.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ClipboardStoredMetadata, CopyOptions, createClipboardCopyEvent, createClipboardPasteEvent, IClipboardCopyEvent, IClipboardPasteEvent, InMemoryClipboardMetadataManager } from '../clipboardUtils.js';
import { _debugComposition, ITextAreaWrapper, ITypeData, TextAreaState } from './textAreaEditContextState.js';
import { ViewContext } from '../../../../common/viewModel/viewContext.js';

export namespace TextAreaSyntethicEvents {
	export const Tap = '-monaco-textarea-synthetic-tap';
}

export interface ICompositionData {
	data: string;
}


export interface IPasteData {
	text: string;
	metadata: ClipboardStoredMetadata | null;
}

export interface ITextAreaInputHost {
	readonly context: ViewContext;
	getScreenReaderContent(): TextAreaState;
	deduceModelPosition(viewAnchorPosition: Position, deltaOffset: number, lineFeedCnt: number): Position;
}

export interface ICompositionStartEvent {
	data: string;
}

export interface ICompleteTextAreaWrapper extends ITextAreaWrapper {
	readonly onKeyDown: Event<KeyboardEvent>;
	readonly onKeyPress: Event<KeyboardEvent>;
	readonly onKeyUp: Event<KeyboardEvent>;
	readonly onCompositionStart: Event<CompositionEvent>;
	readonly onCompositionUpdate: Event<CompositionEvent>;
	readonly onCompositionEnd: Event<CompositionEvent>;
	readonly onBeforeInput: Event<InputEvent>;
	readonly onInput: Event<InputEvent>;
	readonly onCut: Event<ClipboardEvent>;
	readonly onCopy: Event<ClipboardEvent>;
	readonly onPaste: Event<ClipboardEvent>;
	readonly onFocus: Event<FocusEvent>;
	readonly onBlur: Event<FocusEvent>;
	readonly onSyntheticTap: Event<void>;

	readonly ownerDocument: Document;

	setIgnoreSelectionChangeTime(reason: string): void;
	getIgnoreSelectionChangeTime(): number;
	resetSelectionChangeTime(): void;

	hasFocus(): boolean;
}

export interface IBrowser {
	isAndroid: boolean;
	isFirefox: boolean;
	isChrome: boolean;
	isSafari: boolean;
}

class CompositionContext {

	private _lastTypeTextLength: number;

	constructor() {
		this._lastTypeTextLength = 0;
	}

	public handleCompositionUpdate(text: string | null | undefined): ITypeData {
		text = text || '';
		const typeInput: ITypeData = {
			text: text,
			replacePrevCharCnt: this._lastTypeTextLength,
			replaceNextCharCnt: 0,
			positionDelta: 0
		};
		this._lastTypeTextLength = text.length;
		return typeInput;
	}
}

export class TextAreaInput extends Disposable {

	private _onFocus = this._register(new Emitter<void>());
	public readonly onFocus: Event<void> = this._onFocus.event;

	private _onBlur = this._register(new Emitter<void>());
	public readonly onBlur: Event<void> = this._onBlur.event;

	private _onKeyDown = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

	private _onKeyUp = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyUp: Event<IKeyboardEvent> = this._onKeyUp.event;

	private _onCut = this._register(new Emitter<void>());
	public readonly onCut: Event<void> = this._onCut.event;

	private _onPaste = this._register(new Emitter<IPasteData>());
	public readonly onPaste: Event<IPasteData> = this._onPaste.event;

	private _onWillCopy = this._register(new Emitter<IClipboardCopyEvent>());
	public readonly onWillCopy: Event<IClipboardCopyEvent> = this._onWillCopy.event;

	private _onWillCut = this._register(new Emitter<IClipboardCopyEvent>());
	public readonly onWillCut: Event<IClipboardCopyEvent> = this._onWillCut.event;

	private _onWillPaste = this._register(new Emitter<IClipboardPasteEvent>());
	public readonly onWillPaste: Event<IClipboardPasteEvent> = this._onWillPaste.event;

	private _onType = this._register(new Emitter<ITypeData>());
	public readonly onType: Event<ITypeData> = this._onType.event;

	private _onCompositionStart = this._register(new Emitter<ICompositionStartEvent>());
	public readonly onCompositionStart: Event<ICompositionStartEvent> = this._onCompositionStart.event;

	private _onCompositionUpdate = this._register(new Emitter<ICompositionData>());
	public readonly onCompositionUpdate: Event<ICompositionData> = this._onCompositionUpdate.event;

	private _onCompositionEnd = this._register(new Emitter<void>());
	public readonly onCompositionEnd: Event<void> = this._onCompositionEnd.event;

	private _onSelectionChangeRequest = this._register(new Emitter<Selection>());
	public readonly onSelectionChangeRequest: Event<Selection> = this._onSelectionChangeRequest.event;


	private readonly _asyncTriggerCut: RunOnceScheduler;

	private readonly _asyncFocusGainWriteScreenReaderContent: MutableDisposable<RunOnceScheduler> = this._register(new MutableDisposable());

	private _textAreaState: TextAreaState;

	public get textAreaState(): TextAreaState {
		return this._textAreaState;
	}

	private _selectionChangeListener: IDisposable | null;

	private _hasFocus: boolean;
	private _currentComposition: CompositionContext | null;

	constructor(
		private readonly _host: ITextAreaInputHost,
		private readonly _textArea: ICompleteTextAreaWrapper,
		private readonly _OS: OperatingSystem,
		private readonly _browser: IBrowser,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._asyncTriggerCut = this._register(new RunOnceScheduler(() => this._onCut.fire(), 0));
		this._textAreaState = TextAreaState.EMPTY;
		this._selectionChangeListener = null;
		if (this._accessibilityService.isScreenReaderOptimized()) {
			this.writeNativeTextAreaContent('ctor');
		}
		this._register(Event.runAndSubscribe(this._accessibilityService.onDidChangeScreenReaderOptimized, () => {
			if (this._accessibilityService.isScreenReaderOptimized() && !this._asyncFocusGainWriteScreenReaderContent.value) {
				this._asyncFocusGainWriteScreenReaderContent.value = new RunOnceScheduler(() => this.writeNativeTextAreaContent('asyncFocusGain'), 0);
			} else {
				this._asyncFocusGainWriteScreenReaderContent.clear();
			}
		}));
		this._hasFocus = false;
		this._currentComposition = null;

		let lastKeyDown: IKeyboardEvent | null = null;

		this._register(this._textArea.onKeyDown((_e) => {
			const e = new StandardKeyboardEvent(_e);
			if (e.keyCode === KeyCode.KEY_IN_COMPOSITION
				|| (this._currentComposition && e.keyCode === KeyCode.Backspace)) {
				e.stopPropagation();
			}

			if (e.equals(KeyCode.Escape)) {
				e.preventDefault();
			}

			lastKeyDown = e;
			this._onKeyDown.fire(e);
		}));

		this._register(this._textArea.onKeyUp((_e) => {
			const e = new StandardKeyboardEvent(_e);
			this._onKeyUp.fire(e);
		}));

		this._register(this._textArea.onCompositionStart((e) => {
			if (_debugComposition) {
				console.log(`[compositionstart]`, e);
			}

			const currentComposition = new CompositionContext();
			if (this._currentComposition) {
				this._currentComposition = currentComposition;
				return;
			}
			this._currentComposition = currentComposition;

			if (
				this._OS === OperatingSystem.Macintosh
				&& lastKeyDown
				&& lastKeyDown.equals(KeyCode.KEY_IN_COMPOSITION)
				&& this._textAreaState.selectionStart === this._textAreaState.selectionEnd
				&& this._textAreaState.selectionStart > 0
				&& this._textAreaState.value.substr(this._textAreaState.selectionStart - 1, 1) === e.data
				&& (lastKeyDown.code === 'ArrowRight' || lastKeyDown.code === 'ArrowLeft')
			) {
				if (_debugComposition) {
					console.log(`[compositionstart] Handling long press case on macOS + arrow key`, e);
				}
				currentComposition.handleCompositionUpdate('x');
				this._onCompositionStart.fire({ data: e.data });
				return;
			}

			if (this._browser.isAndroid) {
				this._onCompositionStart.fire({ data: e.data });
				return;
			}

			this._onCompositionStart.fire({ data: e.data });
		}));

		this._register(this._textArea.onCompositionUpdate((e) => {
			if (_debugComposition) {
				console.log(`[compositionupdate]`, e);
			}
			const currentComposition = this._currentComposition;
			if (!currentComposition) {
				return;
			}
			if (this._browser.isAndroid) {
				const newState = TextAreaState.readFromTextArea(this._textArea, this._textAreaState);
				const typeInput = TextAreaState.deduceAndroidCompositionInput(this._textAreaState, newState);
				this._textAreaState = newState;
				this._onType.fire(typeInput);
				this._onCompositionUpdate.fire(e);
				return;
			}
			const typeInput = currentComposition.handleCompositionUpdate(e.data);
			this._textAreaState = TextAreaState.readFromTextArea(this._textArea, this._textAreaState);
			this._onType.fire(typeInput);
			this._onCompositionUpdate.fire(e);
		}));

		this._register(this._textArea.onCompositionEnd((e) => {
			if (_debugComposition) {
				console.log(`[compositionend]`, e);
			}
			const currentComposition = this._currentComposition;
			if (!currentComposition) {
				return;
			}
			this._currentComposition = null;

			if (this._browser.isAndroid) {
				const newState = TextAreaState.readFromTextArea(this._textArea, this._textAreaState);
				const typeInput = TextAreaState.deduceAndroidCompositionInput(this._textAreaState, newState);
				this._textAreaState = newState;
				this._onType.fire(typeInput);
				this._onCompositionEnd.fire();
				return;
			}

			const typeInput = currentComposition.handleCompositionUpdate(e.data);
			this._textAreaState = TextAreaState.readFromTextArea(this._textArea, this._textAreaState);
			this._onType.fire(typeInput);
			this._onCompositionEnd.fire();
		}));

		this._register(this._textArea.onInput((e) => {
			if (_debugComposition) {
				console.log(`[input]`, e);
			}

			this._textArea.setIgnoreSelectionChangeTime('received input event');

			if (this._currentComposition) {
				return;
			}

			const newState = TextAreaState.readFromTextArea(this._textArea, this._textAreaState);
			const typeInput = TextAreaState.deduceInput(this._textAreaState, newState, this._OS === OperatingSystem.Macintosh);

			if (typeInput.replacePrevCharCnt === 0 && typeInput.text.length === 1) {
				if (
					strings.isHighSurrogate(typeInput.text.charCodeAt(0))
					|| typeInput.text.charCodeAt(0) === 0x7f
				) {
					return;
				}
			}

			this._textAreaState = newState;
			if (
				typeInput.text !== ''
				|| typeInput.replacePrevCharCnt !== 0
				|| typeInput.replaceNextCharCnt !== 0
				|| typeInput.positionDelta !== 0
			) {
				if (e.inputType === 'insertFromPaste') {
					this._onPaste.fire({
						text: typeInput.text,
						metadata: InMemoryClipboardMetadataManager.INSTANCE.get(typeInput.text)
					});
				} else {
					this._onType.fire(typeInput);
				}
			}
		}));


		this._register(this._textArea.onCut((e) => {
			this._logService.trace(`TextAreaInput#onCut`, e);

			const cutEvent = createClipboardCopyEvent(e, true, this._host.context, this._logService, this._browser.isFirefox);
			this._onWillCut.fire(cutEvent);
			if (cutEvent.isHandled) {
				return;
			}

			this._textArea.setIgnoreSelectionChangeTime('received cut event');

			cutEvent.ensureClipboardGetsEditorData();
			this._asyncTriggerCut.schedule();
		}));

		this._register(this._textArea.onCopy((e) => {
			this._logService.trace(`TextAreaInput#onCopy`, e);

			CopyOptions.electronBugWorkaroundCopyEventHasFired = true;

			const copyEvent = createClipboardCopyEvent(e, false, this._host.context, this._logService, this._browser.isFirefox);
			this._onWillCopy.fire(copyEvent);
			if (copyEvent.isHandled) {
				return;
			}

			copyEvent.ensureClipboardGetsEditorData();
		}));

		this._register(this._textArea.onPaste((e) => {
			this._logService.trace(`TextAreaInput#onPaste`, e);

			const pasteEvent = createClipboardPasteEvent(e);
			this._onWillPaste.fire(pasteEvent);
			if (pasteEvent.isHandled) {
				return;
			}

			this._textArea.setIgnoreSelectionChangeTime('received paste event');

			e.preventDefault();

			this._logService.trace(`TextAreaInput#onPaste with id : `, pasteEvent.metadata?.id, ' with text.length: ', pasteEvent.text.length);
			if (!pasteEvent.text) {
				return;
			}

			this._logService.trace(`TextAreaInput#onPaste (before onPaste)`);
			this._onPaste.fire({
				text: pasteEvent.text,
				metadata: pasteEvent.metadata
			});
		}));

		this._register(this._textArea.onFocus(() => {
			const hadFocus = this._hasFocus;

			this._setHasFocus(true);

			if (this._accessibilityService.isScreenReaderOptimized() && this._browser.isSafari && !hadFocus && this._hasFocus) {
				if (!this._asyncFocusGainWriteScreenReaderContent.value) {
					this._asyncFocusGainWriteScreenReaderContent.value = new RunOnceScheduler(() => this.writeNativeTextAreaContent('asyncFocusGain'), 0);
				}
				this._asyncFocusGainWriteScreenReaderContent.value.schedule();
			}
		}));
		this._register(this._textArea.onBlur(() => {
			if (this._currentComposition) {

				this._currentComposition = null;

				this.writeNativeTextAreaContent('blurWithoutCompositionEnd');

				this._onCompositionEnd.fire();
			}
			this._setHasFocus(false);
		}));
		this._register(this._textArea.onSyntheticTap(() => {
			if (this._browser.isAndroid && this._currentComposition) {

				this._currentComposition = null;

				this.writeNativeTextAreaContent('tapWithoutCompositionEnd');

				this._onCompositionEnd.fire();
			}
		}));
	}

	_initializeFromTest(): void {
		this._hasFocus = true;
		this._textAreaState = TextAreaState.readFromTextArea(this._textArea, null);
	}

	private _installSelectionChangeListener(): IDisposable {

		let previousSelectionChangeEventTime = 0;
		return dom.addDisposableListener(this._textArea.ownerDocument, 'selectionchange', (e) => {
			inputLatency.onSelectionChange();

			if (!this._hasFocus) {
				return;
			}
			if (this._currentComposition) {
				return;
			}
			if (!this._browser.isChrome) {
				return;
			}

			const now = Date.now();

			const delta1 = now - previousSelectionChangeEventTime;
			previousSelectionChangeEventTime = now;
			if (delta1 < 5) {
				return;
			}

			const delta2 = now - this._textArea.getIgnoreSelectionChangeTime();
			this._textArea.resetSelectionChangeTime();
			if (delta2 < 100) {
				return;
			}

			if (!this._textAreaState.selection) {
				return;
			}

			const newValue = this._textArea.getValue();
			if (this._textAreaState.value !== newValue) {
				return;
			}

			const newSelectionStart = this._textArea.getSelectionStart();
			const newSelectionEnd = this._textArea.getSelectionEnd();
			if (this._textAreaState.selectionStart === newSelectionStart && this._textAreaState.selectionEnd === newSelectionEnd) {
				return;
			}

			const _newSelectionStartPosition = this._textAreaState.deduceEditorPosition(newSelectionStart);
			const newSelectionStartPosition = this._host.deduceModelPosition(_newSelectionStartPosition[0]!, _newSelectionStartPosition[1], _newSelectionStartPosition[2]);

			const _newSelectionEndPosition = this._textAreaState.deduceEditorPosition(newSelectionEnd);
			const newSelectionEndPosition = this._host.deduceModelPosition(_newSelectionEndPosition[0]!, _newSelectionEndPosition[1], _newSelectionEndPosition[2]);

			const newSelection = new Selection(
				newSelectionStartPosition.lineNumber, newSelectionStartPosition.column,
				newSelectionEndPosition.lineNumber, newSelectionEndPosition.column
			);

			this._onSelectionChangeRequest.fire(newSelection);
		});
	}

	public override dispose(): void {
		super.dispose();
		if (this._selectionChangeListener) {
			this._selectionChangeListener.dispose();
			this._selectionChangeListener = null;
		}
	}

	public focusTextArea(): void {
		this._setHasFocus(true);

		this.refreshFocusState();
	}

	public isFocused(): boolean {
		return this._hasFocus;
	}

	public refreshFocusState(): void {
		this._setHasFocus(this._textArea.hasFocus());
	}

	private _setHasFocus(newHasFocus: boolean): void {
		if (this._hasFocus === newHasFocus) {
			return;
		}
		this._hasFocus = newHasFocus;

		if (this._selectionChangeListener) {
			this._selectionChangeListener.dispose();
			this._selectionChangeListener = null;
		}
		if (this._hasFocus) {
			this._selectionChangeListener = this._installSelectionChangeListener();
		}

		if (this._hasFocus) {
			this.writeNativeTextAreaContent('focusgain');
		}

		if (this._hasFocus) {
			this._onFocus.fire();
		} else {
			this._onBlur.fire();
		}
	}

	private _setAndWriteTextAreaState(reason: string, textAreaState: TextAreaState): void {
		if (!this._hasFocus) {
			textAreaState = textAreaState.collapseSelection();
		}
		if (!textAreaState.isWrittenToTextArea(this._textArea, this._hasFocus)) {
			this._logService.trace(`writeTextAreaState(reason: ${reason})`);
		}
		textAreaState.writeToTextArea(reason, this._textArea, this._hasFocus);
		this._textAreaState = textAreaState;
	}

	public writeNativeTextAreaContent(reason: string): void {
		if ((!this._accessibilityService.isScreenReaderOptimized() && reason === 'render') || this._currentComposition) {
			return;
		}
		this._setAndWriteTextAreaState(reason, this._host.getScreenReaderContent());
	}
}

export class TextAreaWrapper extends Disposable implements ICompleteTextAreaWrapper {

	public readonly onKeyDown: Event<KeyboardEvent>;
	public readonly onKeyPress: Event<KeyboardEvent>;
	public readonly onKeyUp: Event<KeyboardEvent>;
	public readonly onCompositionStart: Event<CompositionEvent>;
	public readonly onCompositionUpdate: Event<CompositionEvent>;
	public readonly onCompositionEnd: Event<CompositionEvent>;
	public readonly onBeforeInput: Event<InputEvent>;
	public readonly onInput: Event<InputEvent>;
	public readonly onCut: Event<ClipboardEvent>;
	public readonly onCopy: Event<ClipboardEvent>;
	public readonly onPaste: Event<ClipboardEvent>;
	public readonly onFocus: Event<FocusEvent>;
	public readonly onBlur: Event<FocusEvent>;

	public get ownerDocument(): Document {
		return this._actual.ownerDocument;
	}

	private _onSyntheticTap = this._register(new Emitter<void>());
	public readonly onSyntheticTap: Event<void> = this._onSyntheticTap.event;

	private _ignoreSelectionChangeTime: number;

	constructor(
		private readonly _actual: HTMLTextAreaElement
	) {
		super();
		this._ignoreSelectionChangeTime = 0;
		this.onKeyDown = this._register(new DomEmitter(this._actual, 'keydown')).event;
		this.onKeyPress = this._register(new DomEmitter(this._actual, 'keypress')).event;
		this.onKeyUp = this._register(new DomEmitter(this._actual, 'keyup')).event;
		this.onCompositionStart = this._register(new DomEmitter(this._actual, 'compositionstart')).event;
		this.onCompositionUpdate = this._register(new DomEmitter(this._actual, 'compositionupdate')).event;
		this.onCompositionEnd = this._register(new DomEmitter(this._actual, 'compositionend')).event;
		this.onBeforeInput = this._register(new DomEmitter(this._actual, 'beforeinput')).event;
		this.onInput = <Event<InputEvent>>this._register(new DomEmitter(this._actual, 'input')).event;
		this.onCut = this._register(new DomEmitter(this._actual, 'cut')).event;
		this.onCopy = this._register(new DomEmitter(this._actual, 'copy')).event;
		this.onPaste = this._register(new DomEmitter(this._actual, 'paste')).event;
		this.onFocus = this._register(new DomEmitter(this._actual, 'focus')).event;
		this.onBlur = this._register(new DomEmitter(this._actual, 'blur')).event;

		this._register(this.onKeyDown(() => inputLatency.onKeyDown()));
		this._register(this.onBeforeInput(() => inputLatency.onBeforeInput()));
		this._register(this.onInput(() => inputLatency.onInput()));
		this._register(this.onKeyUp(() => inputLatency.onKeyUp()));
		this._register(dom.addDisposableListener(this._actual, TextAreaSyntethicEvents.Tap, () => this._onSyntheticTap.fire()));
	}

	public hasFocus(): boolean {
		const shadowRoot = dom.getShadowRoot(this._actual);
		if (shadowRoot) {
			return shadowRoot.activeElement === this._actual;
		} else if (this._actual.isConnected) {
			return dom.getActiveElement() === this._actual;
		} else {
			return false;
		}
	}

	public setIgnoreSelectionChangeTime(reason: string): void {
		this._ignoreSelectionChangeTime = Date.now();
	}

	public getIgnoreSelectionChangeTime(): number {
		return this._ignoreSelectionChangeTime;
	}

	public resetSelectionChangeTime(): void {
		this._ignoreSelectionChangeTime = 0;
	}

	public getValue(): string {
		return this._actual.value;
	}

	public setValue(reason: string, value: string): void {
		const textArea = this._actual;
		if (textArea.value === value) {
			return;
		}
		this.setIgnoreSelectionChangeTime('setValue');
		textArea.value = value;
	}

	public getSelectionStart(): number {
		return this._actual.selectionDirection === 'backward' ? this._actual.selectionEnd : this._actual.selectionStart;
	}

	public getSelectionEnd(): number {
		return this._actual.selectionDirection === 'backward' ? this._actual.selectionStart : this._actual.selectionEnd;
	}

	public setSelectionRange(reason: string, selectionStart: number, selectionEnd: number): void {
		const textArea = this._actual;

		let activeElement: Element | null = null;
		const shadowRoot = dom.getShadowRoot(textArea);
		if (shadowRoot) {
			activeElement = shadowRoot.activeElement;
		} else {
			activeElement = dom.getActiveElement();
		}
		const activeWindow = dom.getWindow(activeElement);

		const currentIsFocused = (activeElement === textArea);
		const currentSelectionStart = textArea.selectionStart;
		const currentSelectionEnd = textArea.selectionEnd;

		if (currentIsFocused && currentSelectionStart === selectionStart && currentSelectionEnd === selectionEnd) {
			if (browser.isFirefox && activeWindow.parent !== activeWindow) {
				textArea.focus();
			}
			return;
		}


		if (currentIsFocused) {
			this.setIgnoreSelectionChangeTime('setSelectionRange');
			textArea.setSelectionRange(selectionStart, selectionEnd);
			if (browser.isFirefox && activeWindow.parent !== activeWindow) {
				textArea.focus();
			}
			return;
		}

		try {
			const scrollState = dom.saveParentsScrollTop(textArea);
			this.setIgnoreSelectionChangeTime('setSelectionRange');
			textArea.focus();
			textArea.setSelectionRange(selectionStart, selectionEnd);
			dom.restoreParentsScrollTop(textArea, scrollState);
		} catch (e) {
		}
	}
}
