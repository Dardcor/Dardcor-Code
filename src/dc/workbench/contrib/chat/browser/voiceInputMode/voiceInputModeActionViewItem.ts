/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import '../../../../../base/browser/ui/segmentedIconToggle/segmentedIconToggle.css';
import './media/voiceInputMode.css';
import { getActiveWindow, getWindow } from '../../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { BaseActionViewItem } from '../../../../../base/browser/ui/actionbar/actionViewItems.js';
import { IAction } from '../../../../../base/common/actions.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, IObservable, observableFromEvent } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IsDevelopmentContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { resolveVoiceGlowColors } from '../voiceClient/voiceGlow.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { ChatAgentLocation } from '../../common/constants.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { IVoiceSessionController } from '../voiceClient/voiceSessionController.js';
import { IMicCaptureService } from '../voiceClient/micCaptureService.js';
import { ITtsPlaybackService } from '../voiceClient/ttsPlaybackService.js';
import { ChatSpeechToTextState, IChatSpeechToTextService, isDictationActiveOnSurface } from '../speechToText/chatSpeechToTextService.js';
import { setupDictationMicGlow } from '../speechToText/dictationMicGlow.js';
import { DictationDownloadRing, getDictationDownloadHoverContent, getDictationPreparingLabel } from '../speechToText/dictationDownloadRing.js';
import { getDictationHoverContent, getVoiceModeHoverContent } from '../speechToText/micButtonHovers.js';
import { addMicButtonContextMenuListener, getDictationContextMenuActions, getVoiceModeContextMenuActions } from '../speechToText/micButtonMenuActions.js';
import { IVoiceInputModeService, SimulatedVoiceState, VoiceInputMode, VoiceWalkthroughVersion } from './voiceInputMode.js';
import { SegmentedVoiceInputModePillActive } from './voiceInputModeContextKeys.js';
import { AGENTS_VOICE_ENABLED } from '../../../agentsVoice/common/agentsVoice.js';

const DICTATION_TOGGLE_COMMAND_ID = 'workbench.action.chat.toggleSpeechToText';

const VOICE_START_COMMAND_ID = 'agentsVoice.startVoiceInChat';

async function retargetVoiceToCurrentSession(commandService: ICommandService, controller: IVoiceSessionController): Promise<boolean> {
	const currentSession = await commandService.executeCommand<string | undefined>('_chat.voice.getCurrentSession');
	if (!currentSession) {
		return false;
	}
	try {
		const resource = URI.parse(currentSession);
		if (resource.scheme === 'sessions-voice') {
			controller.setDraftTarget();
		} else {
			controller.setTargetSession(resource);
			controller.activateSession(resource);
		}
		return true;
	} catch {
		return false;
	}
}

const WAVEFORM_BAR_COUNT = 4;

const WAVEFORM_BAR_MIN_HEIGHT = 2;
const WAVEFORM_BAR_MAX_HEIGHT = 12;

export class ChatVoiceInputModeAction extends Action2 {

	static readonly ID = 'workbench.action.chat.voiceInputMode';

	constructor() {
		super({
			id: ChatVoiceInputModeAction.ID,
			title: localize2('voiceInputMode', "Voice Input Mode"),
			icon: Codicon.micCompact,
			precondition: SegmentedVoiceInputModePillActive,
			menu: {
				id: MenuId.ChatExecute,
				when: ContextKeyExpr.and(
					SegmentedVoiceInputModePillActive,
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					ChatContextKeys.currentlyEditing.negate(),
				),
				group: 'navigation',
				order: -11,
			},
		});
	}

	run(_accessor: ServicesAccessor): void {
	}
}

export class ChatVoiceInputModeToggleListenAction extends Action2 {

	static readonly ID = 'workbench.action.chat.voiceInputMode.holdToTalk';

	private _holdActive = false;

	constructor() {
		super({
			id: ChatVoiceInputModeToggleListenAction.ID,
			title: localize2('voiceInputMode.holdToTalk', "Voice Mode: Hold to Talk"),
			f1: false,
			precondition: AGENTS_VOICE_ENABLED,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space,
				when: ContextKeyExpr.and(
					AGENTS_VOICE_ENABLED,
					ChatContextKeys.inChatInput,
				),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		if (this._holdActive) {
			return;
		}
		const controller = accessor.get(IVoiceSessionController);
		const keybindingService = accessor.get(IKeybindingService);

		const speechToText = accessor.get(IChatSpeechToTextService);
		if (speechToText.state !== ChatSpeechToTextState.Idle) {
			speechToText.cancel();
		}

		const holdMode = keybindingService.enableKeybindingHoldMode(ChatVoiceInputModeToggleListenAction.ID);

		const win = getActiveWindow();
		let keyReleased = false;
		const releaseListener = dom.addDisposableListener(win, dom.EventType.KEY_UP, () => {
			keyReleased = true;
		});

		this._holdActive = true;
		try {
			await retargetVoiceToCurrentSession(accessor.get(ICommandService), controller);
			if (!controller.isConnected.get() && !controller.isConnecting.get()) {
				await controller.connect(win);
			}
			if (keyReleased) {
				return;
			}
			if (controller.isConnected.get()) {
				controller.pttDown('explicit', true);
				if (holdMode) {
					await holdMode;
				} else if (!keyReleased) {
					await new Promise<void>(resolve => {
						const l = dom.addDisposableListener(win, dom.EventType.KEY_UP, () => {
							l.dispose();
							resolve();
						});
					});
				}
				controller.pttUp('explicit', true);
			}
		} finally {
			releaseListener.dispose();
			this._holdActive = false;
		}
	}
}

const SIMULATE_STATES: { readonly id: string; readonly label: string; readonly state: SimulatedVoiceState | undefined }[] = [
	{ id: 'off', label: 'Off (Disconnected)', state: 'off' },
	{ id: 'connecting', label: 'Connecting', state: 'connecting' },
	{ id: 'idle', label: 'Connected (Idle)', state: 'idle' },
	{ id: 'listening', label: 'Listening', state: 'listening' },
	{ id: 'speaking', label: 'Speaking', state: 'speaking' },
	{ id: 'dictating', label: 'Dictating', state: 'dictating' },
];

export function registerVoiceInputModeSimulateActions(): void {
	const VERSIONS: { readonly version: VoiceWalkthroughVersion; readonly label: string }[] = [
		{ version: 'handsFree', label: 'v4 \u2014 Hands-Free (Auto-Listen)' },
		{ version: 'keyboardHold', label: 'v1 \u2014 Keyboard Hold-to-Talk (Walkie-Talkie)' },
		{ version: 'buttonHold', label: 'v2 \u2014 Button Hold-to-Talk' },
		{ version: 'clickToggle', label: 'v3 \u2014 Button Click-to-Toggle Listening' },
	];
	for (const { version, label } of VERSIONS) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.action.chat.voiceInputMode.simulate.walkthrough.${version}`,
					title: { value: `Voice Input Mode: Prototype Walkthrough \u2014 ${label}`, original: `Voice Input Mode: Prototype Walkthrough \u2014 ${label}` },
					category: { value: 'Developer', original: 'Developer' },
					precondition: IsDevelopmentContext,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor): void {
				accessor.get(IVoiceInputModeService).startVoiceStateWalkthrough(version);
			}
		});
	}

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.voiceInputMode.simulate.step',
				title: { value: 'Voice Input Mode: Prototype Step (Next State)', original: 'Voice Input Mode: Prototype Step (Next State)' },
				category: { value: 'Developer', original: 'Developer' },
				precondition: IsDevelopmentContext,
				f1: true,
			});
		}
		run(accessor: ServicesAccessor): void {
			accessor.get(IVoiceInputModeService).stepVoiceStateWalkthrough();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: 'workbench.action.chat.voiceInputMode.simulate.clear',
				title: { value: 'Voice Input Mode: Simulate \u2014 Clear', original: 'Voice Input Mode: Simulate \u2014 Clear' },
				category: { value: 'Developer', original: 'Developer' },
				precondition: IsDevelopmentContext,
				f1: true,
			});
		}
		run(accessor: ServicesAccessor): void {
			accessor.get(IVoiceInputModeService).clearSimulation();
		}
	});

	for (const { id, label, state } of SIMULATE_STATES) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.action.chat.voiceInputMode.simulate.${id}`,
					title: { value: `Voice Input Mode: Simulate \u2014 ${label}`, original: `Voice Input Mode: Simulate \u2014 ${label}` },
					category: { value: 'Developer', original: 'Developer' },
					precondition: IsDevelopmentContext,
					f1: true,
				});
			}
			run(accessor: ServicesAccessor): void {
				accessor.get(IVoiceInputModeService).setSimulatedVoiceState(state);
			}
		});
	}
}

export interface IVoiceInputModePillOptions {
	readonly toggleDictation?: () => void;
	readonly isActive?: IObservable<boolean>;
	readonly isDictationActive?: IObservable<boolean>;
	readonly isVoiceActive?: IObservable<boolean>;
}

export class VoiceInputModeActionViewItem extends BaseActionViewItem {

	private _reel: HTMLElement | undefined;
	private _dictationCell: HTMLElement | undefined;
	private _voiceCell: HTMLElement | undefined;
	private _listenCell: HTMLElement | undefined;
	private _muteCell: HTMLElement | undefined;
	private _dictationIcon: HTMLElement | undefined;
	private _listenIcon: HTMLElement | undefined;
	private _muteIcon: HTMLElement | undefined;
	private _voiceBars: HTMLElement | undefined;
	private _voiceBarEls: HTMLElement[] = [];
	private _barAnimationFrame: number | undefined;
	private _voiceHovering = false;
	private _voiceLive = false;
	private _barData: Uint8Array | undefined;

	private _listenHoldTimer: number | undefined;
	private _listenHoldListening = false;
	private _listenHoldGesture = false;
	private _listenSuppressClick = false;
	private readonly _listenPointerUp = this._register(new MutableDisposable());
	private readonly _dictationRing = this._register(new MutableDisposable<DictationDownloadRing>());

	private _getLabelWithKeybinding(label: string, commandId: string): string {
		return this.keybindingService.appendKeybinding(label, commandId);
	}

	private _updateAriaLabels(): void {
		this._dictationCell?.setAttribute('aria-label', this._dictationCell.classList.contains('preparing')
			? localize('voiceInputMode.dictationPreparing', "Preparing Speech to Text Model…")
			: this._getLabelWithKeybinding(localize('voiceInputMode.dictation', "Dictation"), DICTATION_TOGGLE_COMMAND_ID));
		this._voiceCell?.setAttribute('aria-label', this._voiceCell.classList.contains('connecting')
			? localize('voiceInputMode.connecting', "Connecting to Voice Mode…")
			: this._voiceCell.classList.contains('on')
				? localize('voiceInputMode.disconnect', "Turn Off Voice Mode")
				: this._getLabelWithKeybinding(localize('voiceInputMode.voice', "Voice Mode"), VOICE_START_COMMAND_ID));
		this._listenCell?.setAttribute('aria-label', this._listenCell.classList.contains('active')
			? this._getLabelWithKeybinding(localize('voiceInputMode.stopListening', "Stop Listening"), ChatVoiceInputModeToggleListenAction.ID)
			: this._getLabelWithKeybinding(localize('voiceInputMode.startListening', "Start Listening"), ChatVoiceInputModeToggleListenAction.ID));
		this._muteCell?.setAttribute('aria-label', this._muteCell.classList.contains('active')
			? localize('voiceInputMode.unmuteMicrophone', "Unmute Microphone")
			: localize('voiceInputMode.muteMicrophone', "Mute Microphone"));
	}

	constructor(
		action: IAction,
		private readonly _options: IVoiceInputModePillOptions | undefined,
		@IVoiceInputModeService private readonly voiceInputModeService: IVoiceInputModeService,
		@IVoiceSessionController private readonly voiceSessionController: IVoiceSessionController,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IHoverService private readonly hoverService: IHoverService,
		@IMicCaptureService private readonly micCaptureService: IMicCaptureService,
		@ITtsPlaybackService private readonly ttsPlaybackService: ITtsPlaybackService,
		@IChatSpeechToTextService private readonly chatSpeechToTextService: IChatSpeechToTextService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IThemeService private readonly themeService: IThemeService,
	) {
		super(undefined, action);
	}

	private _updateVoiceStateColors(container: HTMLElement): void {
		const colors = resolveVoiceGlowColors(this.themeService.getColorTheme());
		container.style.setProperty('--voice-color-listening', colors.listening.toString());
		container.style.setProperty('--voice-color-speaking', colors.speaking.toString());
	}

	override render(container: HTMLElement): void {
		super.render(container);
		container.classList.add('monaco-segmented-icon-toggle-container', 'chat-voice-input-mode-item');

		this._updateVoiceStateColors(container);
		this._register(this.themeService.onDidColorThemeChange(() => this._updateVoiceStateColors(container)));

		const pill = dom.append(container, dom.$('.monaco-segmented-icon-toggle.chat-voice-input-mode'));
		this._reel = dom.append(pill, dom.$('.monaco-segmented-icon-toggle-reel.chat-voice-input-mode-reel'));

		this._dictationCell = dom.append(this._reel, dom.$('button.monaco-segmented-icon-toggle-cell.chat-voice-input-mode-cell.dictation'));
		this._dictationCell.setAttribute('type', 'button');
		this._dictationCell.setAttribute('role', 'button');
		this._dictationIcon = dom.append(this._dictationCell, dom.$('span.chat-voice-input-mode-icon'));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this._dictationCell,
			() => (this._options?.isDictationActive?.get() ?? this._options?.isActive?.get() ?? true) && this.chatSpeechToTextService.isPreparingModel
				? getDictationDownloadHoverContent(this.chatSpeechToTextService)
				: getDictationHoverContent(this._getLabelWithKeybinding(localize('voiceInputMode.dictation', "Dictation"), DICTATION_TOGGLE_COMMAND_ID), this.configurationService)));
		this._register(dom.addDisposableListener(this._dictationCell, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			this._onClickDictation();
		}));
		this._registerActivationKeys(this._dictationCell, () => this._onClickDictation());
		this._register(addMicButtonContextMenuListener(
			this._dictationCell,
			() => getDictationContextMenuActions(this.commandService, this.configurationService, this.keybindingService, DICTATION_TOGGLE_COMMAND_ID),
			this.contextMenuService,
		));
		this._register(setupDictationMicGlow(this._dictationCell, this.chatSpeechToTextService, this.accessibilityService, this._options?.isDictationActive ?? this._options?.isActive, this.themeService));

		this._voiceCell = dom.append(this._reel, dom.$('button.monaco-segmented-icon-toggle-cell.chat-voice-input-mode-cell.voice'));
		this._voiceCell.setAttribute('type', 'button');
		this._voiceCell.setAttribute('role', 'button');
		this._voiceBars = dom.append(this._voiceCell, dom.$('span.chat-voice-input-mode-bars'));
		dom.append(this._voiceCell, dom.$(`span.chat-voice-input-mode-icon.chat-voice-input-mode-spinner${ThemeIcon.asCSSSelector(Codicon.loadingCompact)}`));
		for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
			this._voiceBarEls.push(dom.append(this._voiceBars, dom.$('span.chat-voice-input-mode-bar')));
		}
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this._voiceCell,
			() => {
				const ownsVoice = this._options?.isVoiceActive?.get() ?? this._options?.isActive?.get() ?? true;
				const connectedish = (ownsVoice && (this.voiceSessionController.isConnected.get() || this.voiceSessionController.isConnecting.get())) || this.voiceInputModeService.simulatedVoiceState.get() === 'idle' || this.voiceInputModeService.simulatedVoiceState.get() === 'listening' || this.voiceInputModeService.simulatedVoiceState.get() === 'speaking';
				return getVoiceModeHoverContent(connectedish
					? localize('voiceInputMode.disconnect', "Turn Off Voice Mode")
					: this._getLabelWithKeybinding(localize('voiceInputMode.voice', "Voice Mode"), VOICE_START_COMMAND_ID));
			}));
		this._register(dom.addDisposableListener(this._voiceCell, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			void this._onClickVoicePowerToggle();
		}));
		this._registerActivationKeys(this._voiceCell, () => this._onClickVoicePowerToggle());
		this._register(addMicButtonContextMenuListener(
			this._voiceCell,
			() => getVoiceModeContextMenuActions(this.commandService, this.configurationService, this.keybindingService, VOICE_START_COMMAND_ID),
			this.contextMenuService,
		));
		this._register(dom.addDisposableListener(this._voiceCell, dom.EventType.MOUSE_ENTER, () => {
			this._voiceHovering = true;
			this._stopBarAnimation();
		}));
		this._register(dom.addDisposableListener(this._voiceCell, dom.EventType.MOUSE_LEAVE, () => {
			this._voiceHovering = false;
			this._syncBarAnimation();
		}));

		this._listenCell = dom.append(this._reel, dom.$('button.monaco-segmented-icon-toggle-cell.chat-voice-input-mode-cell.listen'));
		this._listenCell.setAttribute('type', 'button');
		this._listenCell.setAttribute('role', 'button');
		this._listenIcon = dom.append(this._listenCell, dom.$('span.chat-voice-input-mode-icon'));
		this._updateAriaLabels();
		this._register(this.keybindingService.onDidUpdateKeybindings(() => this._updateAriaLabels()));
		this._register(addMicButtonContextMenuListener(
			this._listenCell,
			() => getVoiceModeContextMenuActions(this.commandService, this.configurationService, this.keybindingService, VOICE_START_COMMAND_ID),
			this.contextMenuService,
		));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this._listenCell,
			() => this.voiceSessionController.voiceState.get() === 'listening'
				? this._getLabelWithKeybinding(localize('voiceInputMode.stopListening', "Stop Listening"), ChatVoiceInputModeToggleListenAction.ID)
				: this._getLabelWithKeybinding(localize('voiceInputMode.startOrHoldListening', "Tap to start, or hold to talk"), ChatVoiceInputModeToggleListenAction.ID)));
		this._register(dom.addDisposableGenericMouseDownListener(this._listenCell, (e: MouseEvent) => {
			if (e.button !== 0) {
				return;
			}
			this._onListenPointerDown();
		}));
		this._register(dom.addDisposableListener(this._listenCell, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			if (this._listenSuppressClick) {
				this._listenSuppressClick = false;
				return;
			}
			this._onClickListen();
		}));
		this._registerActivationKeys(this._listenCell, () => this._onClickListen());

		this._muteCell = dom.append(this._reel, dom.$('button.monaco-segmented-icon-toggle-cell.chat-voice-input-mode-cell.mute'));
		this._muteCell.setAttribute('type', 'button');
		this._muteCell.setAttribute('role', 'button');
		this._muteIcon = dom.append(this._muteCell, dom.$('span.chat-voice-input-mode-icon'));
		this._register(addMicButtonContextMenuListener(
			this._muteCell,
			() => getVoiceModeContextMenuActions(this.commandService, this.configurationService, this.keybindingService, VOICE_START_COMMAND_ID),
			this.contextMenuService,
		));
		this._register(this.hoverService.setupManagedHover(getDefaultHoverDelegate('element'), this._muteCell,
			() => this.voiceSessionController.isMuted.get()
				? localize('voiceInputMode.unmuteMicrophone', "Unmute Microphone")
				: localize('voiceInputMode.muteMicrophone', "Mute Microphone")));
		this._register(dom.addDisposableListener(this._muteCell, dom.EventType.CLICK, e => {
			dom.EventHelper.stop(e, true);
			this._onClickMute();
		}));
		this._registerActivationKeys(this._muteCell, () => this._onClickMute());

		const dictationActive = observableFromEvent(this,
			this.chatSpeechToTextService.onDidChangeState,
			() => isDictationActiveOnSurface(this.chatSpeechToTextService, 'chat') && this.chatSpeechToTextService.state !== ChatSpeechToTextState.Idle);

		const dictationPreparing = observableFromEvent(this,
			this.chatSpeechToTextService.onDidChangePreparingModel,
			() => this.chatSpeechToTextService.currentSurface === 'chat' && this.chatSpeechToTextService.isPreparingModel);
		const dictationDownloading = observableFromEvent(this,
			this.chatSpeechToTextService.onDidChangeDownloadingModel,
			() => this.chatSpeechToTextService.isDownloadingModel);

		this._register(autorun(reader => {
			const dictationAvailable = this.voiceInputModeService.dictationAvailable.read(reader);
			const voiceAvailable = this.voiceInputModeService.voiceAvailable.read(reader);
			const simHandsFree = this.voiceInputModeService.simulatedHandsFree.read(reader);
			const handsFree = simHandsFree ?? this.voiceInputModeService.handsFree.read(reader);
			const sim = this.voiceInputModeService.simulatedVoiceState.read(reader);
			const isActive = sim !== undefined || (this._options?.isActive?.read(reader) ?? true);
			const isDictationActive = sim !== undefined || (this._options?.isDictationActive?.read(reader) ?? isActive);
			const isVoiceActive = sim !== undefined || (this._options?.isVoiceActive?.read(reader) ?? isActive);

			let isDictating: boolean;
			let connected: boolean;
			let connecting: boolean;
			let listening: boolean;
			let speaking: boolean;
			if (sim !== undefined) {
				isDictating = sim === 'dictating';
				connecting = sim === 'connecting';
				connected = sim === 'idle' || sim === 'listening' || sim === 'speaking';
				listening = sim === 'listening';
				speaking = sim === 'speaking';
			} else {
				isDictating = isDictationActive && dictationActive.read(reader);
				connected = isVoiceActive && this.voiceSessionController.isConnected.read(reader);
				connecting = isVoiceActive && (this.voiceSessionController.isConnecting.read(reader)
					|| this.voiceSessionController.isReconnecting.read(reader));
				const voiceState = this.voiceSessionController.voiceState.read(reader);
				listening = connected && voiceState === 'listening';
				speaking = connected && voiceState === 'speaking';
			}
			const muted = sim === undefined && connected && this.voiceSessionController.isMuted.read(reader);
			const micListening = listening && !muted;
			const voiceLive = micListening || speaking;
			const voiceOn = connected || connecting;
			this._voiceLive = voiceLive;
			const dictationBusy = sim === undefined && isDictationActive && dictationPreparing.read(reader);

			const showListen = connected && !handsFree;
			const showMute = connected && handsFree;

			const dictationPresent = dictationAvailable && !voiceOn;
			const voicePresent = voiceAvailable && !isDictating && !dictationBusy;
			const listenPresent = showListen;
			const mutePresent = showMute;

			const presentCount = (dictationPresent ? 1 : 0) + (voicePresent ? 1 : 0) + (listenPresent ? 1 : 0) + (mutePresent ? 1 : 0);
			container.classList.toggle('connected', voiceOn);
			container.classList.toggle('single', presentCount === 1);

			this._dictationCell!.classList.toggle('collapsed', !dictationPresent);
			this._dictationCell!.classList.toggle('active', isDictating || dictationBusy);
			this._dictationCell!.classList.toggle('preparing', dictationBusy);
			this._dictationCell!.setAttribute('aria-pressed', String(isDictating));
			this._dictationCell!.setAttribute('aria-label', dictationBusy
				? localize('voiceInputMode.dictationPreparingCancelable', "Cancel Dictation. {0}", getDictationPreparingLabel(this.chatSpeechToTextService))
				: localize('voiceInputMode.dictation', "Dictation"));
			const dictationIcon = dictationBusy
				? dictationDownloading.read(reader) ? Codicon.micDownloadCompact : Codicon.loadingCompact
				: isDictating ? Codicon.micFilled : Codicon.micCompact;
			this._dictationIcon!.className = `chat-voice-input-mode-icon ${ThemeIcon.asClassName(dictationIcon)}`;

			if (dictationBusy && dictationDownloading.read(reader)) {
				if (!this._dictationRing.value) {
					this._dictationRing.value = new DictationDownloadRing(this._dictationCell!, this.chatSpeechToTextService);
				}
			} else {
				this._dictationRing.clear();
			}

			this._voiceCell!.classList.toggle('collapsed', !voicePresent);
			this._voiceCell!.classList.toggle('on', voiceOn);
			this._voiceCell!.classList.toggle('connecting', connecting && !connected);
			this._voiceCell!.classList.toggle('idle-on', voiceOn && !voiceLive);
			this._voiceCell!.classList.toggle('listening', micListening);
			this._voiceCell!.classList.toggle('speaking', speaking);
			this._voiceCell!.setAttribute('aria-pressed', String(voiceOn));
			this._voiceCell!.classList.toggle('sim-hover', this.voiceInputModeService.simulatedHover.read(reader));

			this._listenCell!.classList.toggle('collapsed', !listenPresent);
			this._listenCell!.classList.toggle('active', listening);
			this._listenCell!.classList.toggle('muted', !listening);
			this._listenCell!.setAttribute('aria-pressed', String(listening));
			this._listenIcon!.className = `chat-voice-input-mode-icon ${ThemeIcon.asClassName(listening ? Codicon.personVoiceFilledCompact : Codicon.personVoiceCompact)}`;

			this._muteCell!.classList.toggle('collapsed', !mutePresent);
			this._muteCell!.classList.toggle('active', muted);
			this._muteCell!.setAttribute('aria-pressed', String(muted));
			this._muteIcon!.className = `chat-voice-input-mode-icon ${ThemeIcon.asClassName(muted ? Codicon.micCompact : Codicon.micOffCompact)}`;
			this._updateAriaLabels();

			this._syncBarAnimation();
		}));

		this._register({ dispose: () => this._stopBarAnimation() });
		this._register(this.accessibilityService.onDidChangeReducedMotion(() => {
			this._stopBarAnimation();
			this._syncBarAnimation();
		}));
	}

	private _syncBarAnimation(): void {
		if (this._voiceLive && !this._voiceHovering) {
			this._startBarAnimation();
		} else {
			this._stopBarAnimation();
		}
	}

	private _startBarAnimation(): void {
		if (this._barAnimationFrame !== undefined) {
			return;
		}
		if (this.accessibilityService.isMotionReduced()) {
			for (const bar of this._voiceBarEls) {
				bar.style.animation = 'none';
				bar.style.removeProperty('height');
			}
			return;
		}
		const win = getWindow(this._voiceCell);
		const tick = () => {
			this._barAnimationFrame = win.requestAnimationFrame(tick);
			const analyser = this.voiceSessionController.voiceState.get() === 'speaking'
				? this.ttsPlaybackService.analyserNode
				: this.micCaptureService.analyserNode;
			if (!analyser) {
				for (const bar of this._voiceBarEls) {
					bar.style.removeProperty('height');
					bar.style.removeProperty('animation');
				}
				return;
			}
			if (!this._barData || this._barData.length !== analyser.frequencyBinCount) {
				this._barData = new Uint8Array(analyser.frequencyBinCount);
			}
			analyser.getByteFrequencyData(this._barData as Uint8Array<ArrayBuffer>);
			const bins = this._barData.length;
			const step = Math.max(1, Math.floor(bins / this._voiceBarEls.length));
			for (let i = 0; i < this._voiceBarEls.length; i++) {
				let sum = 0;
				for (let j = 0; j < step; j++) {
					sum += this._barData[Math.min(bins - 1, i * step + j)];
				}
				const intensity = Math.min(1, (sum / step) / 180);
				const heightPx = WAVEFORM_BAR_MIN_HEIGHT + intensity * (WAVEFORM_BAR_MAX_HEIGHT - WAVEFORM_BAR_MIN_HEIGHT);
				this._voiceBarEls[i].style.animation = 'none';
				this._voiceBarEls[i].style.height = `${heightPx}px`;
			}
		};
		this._barAnimationFrame = win.requestAnimationFrame(tick);
	}

	private _stopBarAnimation(): void {
		if (this._barAnimationFrame !== undefined && this._voiceCell) {
			getWindow(this._voiceCell).cancelAnimationFrame(this._barAnimationFrame);
		}
		this._barAnimationFrame = undefined;
		for (const bar of this._voiceBarEls) {
			bar.style.removeProperty('height');
			bar.style.removeProperty('animation');
		}
	}

	private _toggleDictation(): void {
		if (this._options?.toggleDictation) {
			this._options.toggleDictation();
		} else {
			this.commandService.executeCommand(DICTATION_TOGGLE_COMMAND_ID);
		}
	}

	private _registerActivationKeys(cell: HTMLElement, handler: () => void): void {
		this._register(dom.addStandardDisposableListener(cell, dom.EventType.KEY_DOWN, e => {
			if (e.equals(KeyCode.Enter) || e.equals(KeyCode.Space)) {
				e.preventDefault();
				e.stopPropagation();
			}
		}));
		this._register(dom.addStandardDisposableListener(cell, dom.EventType.KEY_UP, e => {
			if (e.equals(KeyCode.Enter) || e.equals(KeyCode.Space)) {
				e.preventDefault();
				e.stopPropagation();
				handler();
			}
		}));
	}

	private _onClickDictation(): void {
		this.voiceInputModeService.setSelectedMode('dictation');

		if (this.voiceSessionController.isConnected.get() || this.voiceSessionController.isConnecting.get()) {
			this.voiceSessionController.disconnect();
		}

		this._toggleDictation();
	}

	private async _onClickVoicePowerToggle(): Promise<void> {
		this.voiceInputModeService.setSelectedMode('voice');

		if (this.chatSpeechToTextService.state !== ChatSpeechToTextState.Idle) {
			this._toggleDictation();
		}

		const controller = this.voiceSessionController;
		const targetWindow = getWindow(this._voiceCell);
		if (controller.isConnected.get() || controller.isConnecting.get()) {
			if (this._options?.isVoiceActive?.get() === false) {
				await retargetVoiceToCurrentSession(this.commandService, controller);
				return;
			}
			controller.disconnect();
		} else {
			await retargetVoiceToCurrentSession(this.commandService, controller);
			controller.connect(targetWindow).catch(() => { });
		}
	}

	private _onClickListen(): void {
		const controller = this.voiceSessionController;
		if (!controller.isConnected.get()) {
			return;
		}
		if (controller.voiceState.get() === 'listening') {
			controller.stopListening();
		} else {
			controller.pttDown();
			controller.pttUp();
		}
	}

	private _onClickMute(): void {
		const controller = this.voiceSessionController;
		if (controller.isConnected.get()) {
			controller.setMuted(!controller.isMuted.get());
		}
	}

	private static readonly HOLD_THRESHOLD_MS = 180;

	private _onListenPointerDown(): void {
		const controller = this.voiceSessionController;
		if (!controller.isConnected.get() || controller.voiceState.get() === 'listening') {
			return;
		}
		this._listenHoldGesture = true;
		this._listenHoldListening = false;
		this._listenSuppressClick = false;
		const win = getWindow(this._listenCell);
		this._listenHoldTimer = win.setTimeout(() => {
			this._listenHoldTimer = undefined;
			if (controller.isConnected.get()) {
				this._listenHoldListening = true;
				controller.pttDown('explicit', true);
			}
		}, VoiceInputModeActionViewItem.HOLD_THRESHOLD_MS);
		this._listenPointerUp.value = dom.addDisposableGenericMouseUpListener(win, (e: MouseEvent) => this._endListenPointerHold(e));
	}

	private _endListenPointerHold(e?: MouseEvent): void {
		if (!this._listenHoldGesture) {
			return;
		}
		this._listenHoldGesture = false;
		this._listenPointerUp.clear();
		if (this._listenHoldTimer !== undefined) {
			getWindow(this._listenCell).clearTimeout(this._listenHoldTimer);
			this._listenHoldTimer = undefined;
			this._listenSuppressClick = false;
		} else if (this._listenHoldListening) {
			this._listenHoldListening = false;
			const releasedOnCell = !!e?.target && this._listenCell!.contains(e.target as Node);
			this._listenSuppressClick = releasedOnCell;
			this.voiceSessionController.pttUp('explicit', true);
		}
	}

	override dispose(): void {
		if (this._listenHoldGesture || this._listenHoldTimer !== undefined) {
			this._endListenPointerHold();
		}
		super.dispose();
	}
}

export function isVoiceInputModeAvailable(voiceInputModeService: IVoiceInputModeService): VoiceInputMode | 'both' | undefined {
	const dictation = voiceInputModeService.dictationAvailable.get();
	const voice = voiceInputModeService.voiceAvailable.get();
	if (dictation && voice) {
		return 'both';
	}
	if (dictation) {
		return 'dictation';
	}
	if (voice) {
		return 'voice';
	}
	return undefined;
}
