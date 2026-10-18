/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getActiveWindow, getWindow } from '../../../../../base/browser/dom.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { AgentsVoiceStorageKeys, AGENTS_VOICE_CONNECTED, AGENTS_VOICE_ENABLED } from '../../../agentsVoice/common/agentsVoice.js';
import { NOTEBOOK_EDITOR_FOCUSED } from '../../../notebook/common/notebookContextKeys.js';
import { SegmentedVoiceInputModePillInactive } from '../voiceInputMode/voiceInputModeContextKeys.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { IChatExecuteActionContext } from './chatExecuteActions.js';
import { IChatWidgetService } from '../chat.js';
import { ChatSpeechToTextState, DictationSettingId, IChatSpeechToTextService } from '../speechToText/chatSpeechToTextService.js';
import { buildMicrophoneOptions, IDictationOnboardingService, RESET_DICTATION_ONBOARDING_COMMAND, SHOW_DICTATION_ONBOARDING_COMMAND } from '../speechToText/dictationOnboarding.js';
import { cancelDictation, isDictating, startDictation, stopDictation } from '../speechToText/dictationSession.js';

export const ChatSpeechToTextConfigured = ContextKeyExpr.and(ChatContextKeys.enabled, ContextKeyExpr.has(ChatContextKeys.speechToTextConfigured.key));
export const ChatSpeechToTextPreparing = ContextKeyExpr.has(ChatContextKeys.speechToTextPreparing.key);
const ChatSpeechToTextMaiBackend = ContextKeyExpr.equals('config.dictation.model', 'mai');
const ChatSpeechToTextButtonShown = ContextKeyExpr.notEquals(`config.${DictationSettingId.ShowButton}`, false);

const HOLD_TO_TALK_THRESHOLD_MS = 500;

export interface IDictationShortcutContext {
	readonly speechService: IChatSpeechToTextService;
	readonly keybindingService: IKeybindingService;
	readonly logService: ILogService;
	readonly onboardingService?: IDictationOnboardingService;
}

export function getDictationShortcutOperation(dictating: boolean, state: ChatSpeechToTextState, preparingModel: boolean): 'start' | 'stop' | 'cancel' | undefined {
	if (dictating) {
		return preparingModel ? 'cancel' : 'stop';
	}
	return state === ChatSpeechToTextState.Idle ? 'start' : undefined;
}

export async function runDictationShortcut(
	context: IDictationShortcutContext,
	commandId: string,
	editor: ICodeEditor,
	startDictationFn: typeof startDictation = startDictation,
): Promise<void> {
	const { speechService, keybindingService, logService } = context;

	switch (getDictationShortcutOperation(isDictating(), speechService.state, speechService.isPreparingModel)) {
		case 'cancel':
			cancelDictation();
			return;
		case 'stop':
			await stopDictation();
			return;
		case undefined:
			return;
	}

	const window = getWindow(editor.getDomNode()) ?? getActiveWindow();

	context.onboardingService?.showIfNeeded();

	const holdMode = keybindingService.enableKeybindingHoldMode(commandId);
	await startDictationFn(speechService, editor, window, logService);
	if (speechService.state === ChatSpeechToTextState.Recording) {
		context.onboardingService?.refreshMicrophones(
			speechService.analyserNode,
			deviceId => speechService.switchMicrophone(window, deviceId),
		);
	}
	if (!holdMode) {
		return;
	}

	const heldFrom = Date.now();
	await holdMode;
	const heldMs = Date.now() - heldFrom;

	if (heldMs < HOLD_TO_TALK_THRESHOLD_MS) {
		return;
	}

	await stopDictation();
}

export class ToggleChatSpeechToTextAction extends Action2 {
	static readonly ID = 'workbench.action.chat.toggleSpeechToText';

	constructor() {
		super({
			id: ToggleChatSpeechToTextAction.ID,
			title: localize2('chat.speechToText.start', "Dictate (Speech to Text)"),
			category: CHAT_CATEGORY,
			icon: Codicon.micCompact,
			f1: false,
			toggled: {
				condition: ChatContextKeys.speechToTextRecording,
				icon: Codicon.micFilled,
				title: localize2('chat.speechToText.stop', "Stop Dictation").value,
			},
			menu: [{
				id: MenuId.ChatExecute,
				order: -11,
				when: ContextKeyExpr.and(ChatSpeechToTextConfigured, ChatSpeechToTextButtonShown, ChatSpeechToTextPreparing.negate(), AGENTS_VOICE_CONNECTED.negate(), SegmentedVoiceInputModePillInactive),
				group: 'navigation',
			}],
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 1,
				when: ContextKeyExpr.and(
					ChatSpeechToTextConfigured,
					ChatContextKeys.inChatInput,
					EditorContextKeys.focus.negate(),
					NOTEBOOK_EDITOR_FOCUSED.negate(),
				),
				primary: KeyMod.CtrlCmd | KeyCode.KeyI,
			},
		});
	}

	async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const context = args[0] as IChatExecuteActionContext | undefined;
		const widgetService = accessor.get(IChatWidgetService);

		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget) {
			return;
		}

		await runDictationShortcut({
			speechService: accessor.get(IChatSpeechToTextService),
			keybindingService: accessor.get(IKeybindingService),
			logService: accessor.get(ILogService),
			onboardingService: accessor.get(IDictationOnboardingService),
		}, ToggleChatSpeechToTextAction.ID, widget.inputEditor);
	}
}

export class ChatSpeechToTextPreparingAction extends Action2 {
	static readonly ID = 'workbench.action.chat.speechToTextPreparing';

	constructor() {
		super({
			id: ChatSpeechToTextPreparingAction.ID,
			title: localize2('chat.speechToText.preparing', "Preparing Speech to Text Model…"),
			category: CHAT_CATEGORY,
			f1: false,
			icon: Codicon.micDownloadCompact,
			precondition: ChatSpeechToTextPreparing,
			menu: [{
				id: MenuId.ChatExecute,
				order: -11,
				when: ContextKeyExpr.and(ChatSpeechToTextConfigured, ChatSpeechToTextButtonShown, ChatSpeechToTextPreparing, ChatSpeechToTextMaiBackend.negate(), AGENTS_VOICE_CONNECTED.negate(), SegmentedVoiceInputModePillInactive),
				group: 'navigation',
			}],
		});
	}

	async run(): Promise<void> {
		if (isDictating()) {
			cancelDictation();
		}
	}
}

export class ChatSpeechToTextConnectingAction extends Action2 {
	static readonly ID = 'workbench.action.chat.speechToTextConnecting';

	constructor() {
		super({
			id: ChatSpeechToTextConnectingAction.ID,
			title: localize2('chat.speechToText.connecting', "Connecting to Speech to Text…"),
			category: CHAT_CATEGORY,
			f1: false,
			icon: Codicon.loadingCompact,
			precondition: ChatSpeechToTextPreparing,
			menu: [{
				id: MenuId.ChatExecute,
				order: -11,
				when: ContextKeyExpr.and(ChatSpeechToTextConfigured, ChatSpeechToTextButtonShown, ChatSpeechToTextPreparing, ChatSpeechToTextMaiBackend, AGENTS_VOICE_CONNECTED.negate(), SegmentedVoiceInputModePillInactive),
				group: 'navigation',
			}],
		});
	}

	async run(): Promise<void> {
		if (isDictating()) {
			cancelDictation();
		}
	}
}

class HoldToSpeechToTextAction extends Action2 {
	static readonly ID = 'workbench.action.chat.holdToSpeechToText';

	constructor() {
		super({
			id: HoldToSpeechToTextAction.ID,
			title: localize2('chat.speechToText.hold', "Hold to Dictate (Speech to Text)"),
			category: CHAT_CATEGORY,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const context = args[0] as IChatExecuteActionContext | undefined;
		const widgetService = accessor.get(IChatWidgetService);
		const speechService = accessor.get(IChatSpeechToTextService);
		const keybindingService = accessor.get(IKeybindingService);

		const widget = context?.widget ?? widgetService.lastFocusedWidget;
		if (!widget || speechService.state !== ChatSpeechToTextState.Idle) {
			return;
		}

		const holdMode = keybindingService.enableKeybindingHoldMode(HoldToSpeechToTextAction.ID);
		if (!holdMode) {
			return;
		}

		const window = getWindow(widget.domNode) ?? getActiveWindow();
		const heldFrom = Date.now();
		await startDictation(speechService, widget.inputEditor, window, accessor.get(ILogService));

		await holdMode;

		if (Date.now() - heldFrom < HOLD_TO_TALK_THRESHOLD_MS) {
			cancelDictation();
			return;
		}

		await stopDictation();
	}
}

class SelectSpeechToTextMicrophoneAction extends Action2 {
	static readonly ID = 'workbench.action.chat.selectSpeechToTextMicrophone';

	constructor() {
		super({
			id: SelectSpeechToTextMicrophoneAction.ID,
			title: localize2('chat.speechToText.selectMicrophone', "Select Microphone"),
			category: CHAT_CATEGORY,
			f1: true,
			precondition: ContextKeyExpr.or(ChatSpeechToTextConfigured, AGENTS_VOICE_ENABLED),
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const storageService = accessor.get(IStorageService);

		const devices = await navigator.mediaDevices.enumerateDevices();

		if (!devices.some(device => device.kind === 'audioinput')) {
			quickInputService.pick([{ label: localize('chatStt.noMicrophones', "No microphones found") }]);
			return;
		}

		const currentDeviceId = storageService.get(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION, '');

		type DevicePickItem = { label: string; description?: string; deviceId: string };
		const items: DevicePickItem[] = buildMicrophoneOptions(devices).map(device => ({
			label: device.label,
			description: device.deviceId === currentDeviceId ? localize('chatStt.current', "(current)") : undefined,
			deviceId: device.deviceId,
		}));

		const picked = await quickInputService.pick(items, {
			placeHolder: localize('chatStt.selectMic', "Select a microphone for dictation"),
		});

		if (picked) {
			const selection = picked as DevicePickItem;
			if (selection.deviceId) {
				storageService.store(AgentsVoiceStorageKeys.MicrophoneDevice, selection.deviceId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			} else {
				storageService.remove(AgentsVoiceStorageKeys.MicrophoneDevice, StorageScope.APPLICATION);
			}
		}
	}
}

class ShowChatSpeechToTextIntroductionAction extends Action2 {
	static readonly ID = SHOW_DICTATION_ONBOARDING_COMMAND;

	constructor() {
		super({
			id: ShowChatSpeechToTextIntroductionAction.ID,
			title: localize2('chat.speechToText.showIntroduction', "Dictate: Show Introduction"),
			category: CHAT_CATEGORY,
			f1: true,
			precondition: ChatSpeechToTextConfigured,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const onboardingService = accessor.get(IDictationOnboardingService);
		if (onboardingService.show()) {
			return;
		}

		accessor.get(INotificationService).info(localize('chatStt.introductionNeedsChat', "Open a chat to see the dictation introduction."));
	}
}

class ResetChatSpeechToTextIntroductionAction extends Action2 {
	constructor() {
		super({
			id: RESET_DICTATION_ONBOARDING_COMMAND,
			title: localize2('chat.speechToText.resetIntroduction', "Dictate: Reset Onboarding"),
			category: CHAT_CATEGORY,
			f1: true,
			precondition: ChatSpeechToTextConfigured,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IDictationOnboardingService).reset();
	}
}

class CancelChatSpeechToTextAction extends Action2 {
	static readonly ID = 'workbench.action.chat.cancelSpeechToText';

	constructor() {
		super({
			id: CancelChatSpeechToTextAction.ID,
			title: localize2('chat.speechToText.cancel', "Cancel Dictation (Speech to Text)"),
			category: CHAT_CATEGORY,
			f1: false,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 1,
				when: ContextKeyExpr.and(
					ChatContextKeys.speechToTextRecording,
					ChatContextKeys.inChatInput,
				),
				primary: KeyCode.Escape,
			},
		});
	}

	async run(): Promise<void> {
		if (isDictating()) {
			cancelDictation();
		}
	}
}

export function registerChatSpeechToTextActions(): DisposableStore {
	const store = new DisposableStore();
	store.add(registerAction2(ToggleChatSpeechToTextAction));
	store.add(registerAction2(ChatSpeechToTextPreparingAction));
	store.add(registerAction2(ChatSpeechToTextConnectingAction));
	store.add(registerAction2(HoldToSpeechToTextAction));
	store.add(registerAction2(CancelChatSpeechToTextAction));
	store.add(registerAction2(ShowChatSpeechToTextIntroductionAction));
	store.add(registerAction2(ResetChatSpeechToTextIntroductionAction));
	store.add(registerAction2(SelectSpeechToTextMicrophoneAction));
	return store;
}
