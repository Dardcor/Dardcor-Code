/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { isNumber } from '../../../../../base/common/types.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { SpeechTimeoutDefault } from '../../../accessibility/browser/accessibilityConfiguration.js';
import { ISpeechService, AccessibilityVoiceSettingId, ISpeechToTextEvent, SpeechToTextStatus } from '../../../speech/common/speechService.js';
import { ChatSpeechToTextState, IChatSpeechToTextService } from '../../../chat/browser/speechToText/chatSpeechToTextService.js';
import { getDictationPreparingLabel } from '../../../chat/browser/speechToText/dictationDownloadRing.js';
import type { IMarker, IDecoration } from '@xterm/xterm';
import { alert } from '../../../../../base/browser/ui/aria/aria.js';
import { addDisposableListener, EventType, getActiveWindow } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { TerminalCommandId } from '../../../terminal/common/terminal.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { TerminalInitialHintContribution } from '../../inlineHint/browser/terminal.initialHint.contribution.js';


const symbolMap: [spoken: string, symbol: string][] = [
	['dollar sign', '$'],
	['double quote', '"'],
	['open paren', '('],
	['close paren', ')'],
	['open parenthesis', '('],
	['close parenthesis', ')'],
	['open bracket', '['],
	['close bracket', ']'],
	['open brace', '{'],
	['close brace', '}'],
	['open angle bracket', '<'],
	['close angle bracket', '>'],
	['greater than', '>'],
	['less than', '<'],
	['ampersand', '&'],
	['dollar', '$'],
	['percent', '%'],
	['asterisk', '*'],
	['star', '*'],
	['plus', '+'],
	['equals', '='],
	['exclamation', '!'],
	['forward slash', '/'],
	['slash', '/'],
	['backslash', '\\'],
	['pipe', '|'],
	['tilde', '~'],
	['caret', '^'],
	['at sign', '@'],
	['hashtag', '#'],
	['pound', '#'],
	['hash', '#'],
	['colon', ':'],
	['semicolon', ';'],
	['underscore', '_'],
	['hyphen', '-'],
	['dash', '-'],
	['dot', '.'],
	['period', '.'],
	['quote', '\''],
];

export function postProcessTerminalDictation(text: string): string {
	let input = text.replaceAll(/[.,?;!]/g, '');
	for (const [spoken, symbol] of symbolMap) {
		input = input.replace(new RegExp('\\b' + spoken + '\\b', 'gi'), symbol);
	}
	input = input.replace(/^(\s*)([A-Z])/, (_, leading: string, letter: string) => leading + letter.toLowerCase());
	return input;
}

export class TerminalVoiceSession extends Disposable {
	private _input: string = '';
	private _ghostText: IDecoration | undefined;
	private _decoration: IDecoration | undefined;
	private _marker: IMarker | undefined;
	private _ghostTextMarker: IMarker | undefined;
	private static _instance: TerminalVoiceSession | undefined = undefined;
	private _acceptTranscriptionScheduler: RunOnceScheduler | undefined;
	private readonly _terminalDictationInProgress: IContextKey<boolean>;
	private _usingBuiltin = false;
	private _builtinFinalizing = false;
	private _sessionTerminalInstanceId: number | undefined;
	private _sessionTerminalDisposed = false;
	static getInstance(instantiationService: IInstantiationService): TerminalVoiceSession {
		if (!TerminalVoiceSession._instance) {
			TerminalVoiceSession._instance = instantiationService.createInstance(TerminalVoiceSession);
		}

		return TerminalVoiceSession._instance;
	}
	private _cancellationTokenSource: CancellationTokenSource | undefined;
	private readonly _disposables: DisposableStore;
	private readonly _decorationDisposables: DisposableStore;
	constructor(
		@ISpeechService private readonly _speechService: ISpeechService,
		@IChatSpeechToTextService private readonly _chatSpeechToTextService: IChatSpeechToTextService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super();
		this._disposables = this._register(new DisposableStore());
		this._decorationDisposables = this._register(new DisposableStore());
		this._terminalDictationInProgress = TerminalContextKeys.terminalDictationInProgress.bindTo(contextKeyService);
	}

	async start(): Promise<void> {
		this.stop();
		const activeInstance = this._terminalService.activeInstance;
		this._sessionTerminalInstanceId = activeInstance?.instanceId;
		this._sessionTerminalDisposed = false;
		this._disposables.add(this._terminalService.onDidChangeActiveInstance(instance => {
			if (instance?.instanceId !== this._sessionTerminalInstanceId) {
				this.stop();
			}
		}));
		this._disposables.add(this._terminalService.onDidDisposeInstance(instance => {
			if (instance.instanceId === this._sessionTerminalInstanceId) {
				this._sessionTerminalDisposed = true;
				this.stop();
			}
		}));
		if (activeInstance) {
			TerminalInitialHintContribution.get(activeInstance)?.dispose();
		}
		let voiceTimeout = this._configurationService.getValue<number>(AccessibilityVoiceSettingId.SpeechTimeout);
		if (!isNumber(voiceTimeout) || voiceTimeout < 0) {
			voiceTimeout = SpeechTimeoutDefault;
		}
		this._acceptTranscriptionScheduler = this._disposables.add(new RunOnceScheduler(() => {
			if (this._usingBuiltin) {
				this.stop(true);
				return;
			}
			this._sendText();
			this.stop();
		}, voiceTimeout));
		this._cancellationTokenSource = new CancellationTokenSource();
		this._register(toDisposable(() => this._cancellationTokenSource?.dispose(true)));

		if (this._chatSpeechToTextService.isConfigured) {
			return this._startBuiltin(voiceTimeout);
		}

		const session = await this._speechService.createSpeechToTextSession(this._cancellationTokenSource?.token, 'terminal');

		this._disposables.add(session.onDidChange((e) => {
			if (this._cancellationTokenSource?.token.isCancellationRequested) {
				return;
			}
			switch (e.status) {
				case SpeechToTextStatus.Started:
					this._terminalDictationInProgress.set(true);
					if (!this._decoration) {
						this._createDecoration();
					}
					break;
				case SpeechToTextStatus.Recognizing: {
					this._updateInput(e);
					this._renderGhostText(e);
					this._updateDecoration();
					if (voiceTimeout > 0) {
						this._acceptTranscriptionScheduler!.cancel();
					}
					break;
				}
				case SpeechToTextStatus.Recognized:
					this._updateInput(e);
					this._sendText();
					this._ghostText?.dispose();
					this._ghostText = undefined;
					this._ghostTextMarker?.dispose();
					this._ghostTextMarker = undefined;
					this._updateDecoration();
					this._input = '';
					break;
				case SpeechToTextStatus.Stopped:
					this.stop();
					break;
			}
		}));
	}

	private async _startBuiltin(voiceTimeout: number): Promise<void> {
		const service = this._chatSpeechToTextService;

		if (service.isBusy) {
			await service.cancel();
		}
		if (service.state !== ChatSpeechToTextState.Idle) {
			this.stop();
			return;
		}

		this._usingBuiltin = true;
		this._terminalDictationInProgress.set(true);
		if (!this._decoration) {
			this._createDecoration();
		}

		const renderPreparing = () => {
			if (this._cancellationTokenSource?.token.isCancellationRequested || this._builtinFinalizing) {
				return;
			}
			if (service.isPreparingModel) {
				this._renderPreparingText(getDictationPreparingLabel(service));
			}
		};
		renderPreparing();
		this._disposables.add(service.onDidChangePreparingModel(() => renderPreparing()));
		this._disposables.add(service.onDidChangeModelDownloadProgress(() => renderPreparing()));

		this._disposables.add(service.onDidUpdateTranscript(update => {
			if (this._cancellationTokenSource?.token.isCancellationRequested || this._builtinFinalizing) {
				return;
			}
			const event: ISpeechToTextEvent = { status: SpeechToTextStatus.Recognizing, text: update.text };
			this._updateInput(event);
			this._renderGhostText(event);
			this._updateDecoration();
			if (voiceTimeout > 0) {
				this._acceptTranscriptionScheduler!.cancel();
				this._acceptTranscriptionScheduler!.schedule();
			}
		}));

		this._disposables.add(service.onDidChangeState(state => {
			if (state === ChatSpeechToTextState.Idle && !this._builtinFinalizing && !this._cancellationTokenSource?.token.isCancellationRequested) {
				this.stop();
			}
		}));

		try {
			await service.start(getActiveWindow(), 'terminal');
		} catch {
			this.stop();
		}
	}

	private async _finalizeBuiltinThenStop(): Promise<void> {
		let finalText: string | undefined;
		try {
			finalText = await this._chatSpeechToTextService.stopAndTranscribe();
		} catch {
		}
		if (!this._usingBuiltin || this._cancellationTokenSource?.token.isCancellationRequested) {
			return;
		}
		if (finalText !== undefined) {
			this._updateInput({ status: SpeechToTextStatus.Recognized, text: finalText });
		}
		this.stop(true);
	}

	stop(send?: boolean): void {
		if (this._usingBuiltin && send && !this._builtinFinalizing) {
			this._builtinFinalizing = true;
			this._acceptTranscriptionScheduler?.cancel();
			this._finalizeBuiltinThenStop();
			return;
		}
		if (this._builtinFinalizing && !send
			&& !this._sessionTerminalDisposed
			&& this._terminalService.activeInstance?.instanceId === this._sessionTerminalInstanceId) {
			return;
		}
		this._setInactive();
		if (send) {
			this._acceptTranscriptionScheduler!.cancel();
			this._sendText();
		}
		this._ghostText = undefined;
		this._decoration?.dispose();
		this._decoration = undefined;
		this._marker?.dispose();
		this._marker = undefined;
		this._ghostTextMarker = undefined;
		this._cancellationTokenSource?.cancel();
		if (this._usingBuiltin) {
			void this._chatSpeechToTextService.cancel();
		}
		this._disposables.clear();
		this._input = '';
		this._terminalDictationInProgress.reset();
		this._usingBuiltin = false;
		this._builtinFinalizing = false;
		this._sessionTerminalInstanceId = undefined;
		this._sessionTerminalDisposed = false;
	}

	private _sendText(): void {
		this._terminalService.activeInstance?.sendText(this._input, false);
		alert(localize('terminalVoiceTextInserted', '{0} inserted', this._input));
	}

	private _updateInput(e: ISpeechToTextEvent): void {
		if (e.text) {
			this._input = ' ' + postProcessTerminalDictation(e.text);
		}
	}

	private _createDecoration(): void {
		const activeInstance = this._terminalService.activeInstance;
		const xterm = activeInstance?.xterm?.raw;
		if (!xterm) {
			return;
		}
		const onFirstLine = xterm.buffer.active.cursorY === 0;

		const inputLength = this._input.length;
		const xPosition = xterm.buffer.active.cursorX + inputLength;

		this._marker = activeInstance.registerMarker(onFirstLine ? 0 : -1);
		if (!this._marker) {
			return;
		}
		this._decoration = xterm.registerDecoration({
			marker: this._marker,
			layer: 'top',
			x: xPosition,
		});
		if (!this._decoration) {
			this._marker.dispose();
			this._marker = undefined;
			return;
		}
		this._decoration.onRender((e: HTMLElement) => {
			e.classList.add(...ThemeIcon.asClassNameArray(Codicon.micFilled), 'terminal-voice', 'recording');
			e.style.transform = onFirstLine ? 'translate(10px, -2px)' : 'translate(-6px, -5px)';
			this._registerMicInteractions(e);
		});
	}

	private _registerMicInteractions(element: HTMLElement): void {
		if (element.dataset.terminalVoiceInteractive) {
			return;
		}
		element.dataset.terminalVoiceInteractive = 'true';
		element.style.cursor = 'pointer';
		this._decorationDisposables.add(addDisposableListener(element, EventType.CLICK, e => {
			e.preventDefault();
			e.stopPropagation();
			if (!this._builtinFinalizing) {
				this.stop(true);
			}
		}));
		const keybindingLabel = this._keybindingService.lookupKeybinding(TerminalCommandId.StopVoice)?.getLabel();
		const title = keybindingLabel
			? localize('terminalVoice.stopDictationHover', "Stop Dictation ({0})", keybindingLabel)
			: localize('terminalVoice.stopDictationHoverNoKeybinding', "Stop Dictation");
		this._decorationDisposables.add(this._hoverService.setupManagedHover(getDefaultHoverDelegate('mouse'), element, title));
	}

	private _updateDecoration(): void {
		this._decorationDisposables.clear();
		this._decoration?.dispose();
		this._marker?.dispose();
		this._decoration = undefined;
		this._marker = undefined;
		this._createDecoration();
	}

	private _setInactive(): void {
		this._decoration?.element?.classList.remove('recording');
	}

	private _renderGhostText(e: ISpeechToTextEvent): void {
		this._renderGhostTextContent(e.text, 'terminal-voice-progress-text');
	}

	private _renderPreparingText(label: string): void {
		this._renderGhostTextContent(label, 'terminal-voice-preparing-text');
	}

	private _renderGhostTextContent(text: string | undefined, className: string): void {
		this._ghostText?.dispose();
		if (!text) {
			return;
		}
		const activeInstance = this._terminalService.activeInstance;
		const xterm = activeInstance?.xterm?.raw;
		if (!xterm) {
			return;
		}
		this._ghostTextMarker = activeInstance.registerMarker();
		if (!this._ghostTextMarker) {
			return;
		}
		this._disposables.add(this._ghostTextMarker);
		const onFirstLine = xterm.buffer.active.cursorY === 0;
		this._ghostText = xterm.registerDecoration({
			marker: this._ghostTextMarker,
			layer: 'top',
			x: onFirstLine ? xterm.buffer.active.cursorX + 4 : xterm.buffer.active.cursorX + 1,
		});
		if (this._ghostText) {
			this._disposables.add(this._ghostText);
		}
		this._ghostText?.onRender((e: HTMLElement) => {
			e.classList.add(className);
			e.textContent = text;
			e.style.width = (xterm.cols - xterm.buffer.active.cursorX) / xterm.cols * 100 + '%';
		});
	}
}
