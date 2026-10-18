/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../chat/browser/voiceClient/micCaptureService.js';
import '../../chat/browser/voiceClient/ttsPlaybackService.js';
import '../../chat/browser/voiceClient/voiceClientService.js';
import { IVoiceSessionController, isVoiceEntitled } from '../../chat/browser/voiceClient/voiceSessionController.js';
import { IChatInputWindowService } from '../../chat/common/chatInputWindow.js';
import { normalizeAgentsVoiceId, VOICE_AGENT_PROGRESS_SETTING } from '../../chat/common/voiceClient/voiceClientService.js';
import '../../chat/browser/voiceClient/voiceToolDispatchService.js';
import '../../chat/common/voicePlaybackService.js';

import '../common/voiceTranscriptStore.js';

import './transcriptsView/voiceTranscripts.contribution.js';

import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { URI } from '../../../../base/common/uri.js';
import * as nls from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { SegmentedVoiceInputModePillInactive } from '../../chat/browser/voiceInputMode/voiceInputModeContextKeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ConfigurationKeyValuePairs, IConfigurationMigrationRegistry, Extensions as WorkbenchConfigurationExtensions } from '../../../common/configuration.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { AgentsVoiceSettingId, AgentsVoiceStorageKeys, AGENTS_VOICE_CONNECTED, AGENTS_VOICE_CONNECTING, AGENTS_VOICE_ENABLED, AGENTS_VOICE_ENTITLED, AGENTS_VOICE_LISTENING } from '../common/agentsVoice.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IChatEntitlementService } from '../../../services/chat/common/chatEntitlementService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import {
	VoiceEnabledClassification, VoiceEnabledEvent,
	VoiceDisabledClassification, VoiceDisabledEvent,
} from '../../chat/browser/voiceClient/voiceTelemetry.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { getActiveWindow } from '../../../../base/browser/dom.js';
import { ChatAgentLocation } from '../../chat/common/constants.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { CONFIGURE_VOICE_INSTRUCTIONS_ACTION_ID } from '../../chat/browser/actions/configureVoiceInstructionsAction.js';
import { IVoiceModeOnboardingService } from './voiceModeOnboarding.js';
import { SHOW_VOICE_MODE_ONBOARDING_COMMAND } from '../../chat/browser/speechToText/micButtonMenuActions.js';


export const AGENTS_VOICE_WIDGET_FOCUSED = new RawContextKey<boolean>('agentsVoiceWidgetFocused', false);


class AgentsVoiceEntitlementKeyContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentsVoiceEntitlementKey';

	constructor(
		@IChatEntitlementService chatEntitlementService: IChatEntitlementService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const entitledKey = AGENTS_VOICE_ENTITLED.bindTo(contextKeyService);
		const update = () => entitledKey.set(isVoiceEntitled(chatEntitlementService));
		update();
		this._register(chatEntitlementService.onDidChangeEntitlement(update));
	}
}

registerWorkbenchContribution2(AgentsVoiceEntitlementKeyContribution.ID, AgentsVoiceEntitlementKeyContribution, WorkbenchPhase.AfterRestored);

class AgentsVoiceConnectedKeyContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.agentsVoiceConnectedKey';

	constructor(
		@IVoiceSessionController voiceSessionController: IVoiceSessionController,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		const connectedKey = AGENTS_VOICE_CONNECTED.bindTo(contextKeyService);
		const connectingKey = AGENTS_VOICE_CONNECTING.bindTo(contextKeyService);
		const listeningKey = AGENTS_VOICE_LISTENING.bindTo(contextKeyService);
		this._register(autorun(reader => {
			connectedKey.set(voiceSessionController.isConnected.read(reader));
			connectingKey.set(voiceSessionController.isConnecting.read(reader));
			listeningKey.set(voiceSessionController.voiceState.read(reader) === 'listening');
		}));
	}
}

registerWorkbenchContribution2(AgentsVoiceConnectedKeyContribution.ID, AgentsVoiceConnectedKeyContribution, WorkbenchPhase.Eventually);


class AgentsVoiceTelemetryContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentsVoiceTelemetry';
	private static readonly _ENABLED_AT_KEY = 'agents.voice.enabledAtMs';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('agents.voice.enabled')) {
				const enabled = configurationService.getValue<boolean>('agents.voice.enabled');
				if (enabled) {
					storageService.store(AgentsVoiceTelemetryContribution._ENABLED_AT_KEY, Date.now(), StorageScope.PROFILE, StorageTarget.MACHINE);
					telemetryService.publicLog2<VoiceEnabledEvent, VoiceEnabledClassification>('voiceEnabled', { source: 'setting' });
				} else {
					const enabledAt = storageService.getNumber(AgentsVoiceTelemetryContribution._ENABLED_AT_KEY, StorageScope.PROFILE, 0);
					const daysActive = enabledAt ? Math.round((Date.now() - enabledAt) / (1000 * 60 * 60 * 24)) : 0;
					telemetryService.publicLog2<VoiceDisabledEvent, VoiceDisabledClassification>('voiceDisabled', { daysActive });
					storageService.remove(AgentsVoiceTelemetryContribution._ENABLED_AT_KEY, StorageScope.PROFILE);
				}
			}
		}));
	}
}

registerWorkbenchContribution2(AgentsVoiceTelemetryContribution.ID, AgentsVoiceTelemetryContribution, WorkbenchPhase.AfterRestored);


class AgentsVoiceOnboardingContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentsVoiceOnboarding';

	constructor(
		@IVoiceSessionController voiceSessionController: IVoiceSessionController,
		@IVoiceModeOnboardingService voiceModeOnboardingService: IVoiceModeOnboardingService,
	) {
		super();

		this._register(autorun(reader => {
			if (voiceSessionController.isConnecting.read(reader) || voiceSessionController.isConnected.read(reader)) {
				voiceModeOnboardingService.showIfNeeded();
			}
		}));
	}
}

registerWorkbenchContribution2(AgentsVoiceOnboardingContribution.ID, AgentsVoiceOnboardingContribution, WorkbenchPhase.Eventually);


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.connecting',
			title: nls.localize2('agentsVoice.connecting', "Connecting..."),
			icon: Codicon.loadingCompact,
			precondition: ContextKeyExpr.and(
				AGENTS_VOICE_ENABLED,
				AGENTS_VOICE_CONNECTING.isEqualTo(true),
			),
			menu: {
				id: MenuId.ChatExecute,
				when: ContextKeyExpr.and(
					SegmentedVoiceInputModePillInactive,
					AGENTS_VOICE_ENABLED,
					ContextKeyExpr.notEquals(`config.${AgentsVoiceSettingId.ShowButton}`, false),
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					AGENTS_VOICE_CONNECTING.isEqualTo(true),
				),
				group: 'navigation',
				order: -10
			}
		});
	}
	async run(): Promise<void> {
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.startVoiceInChat',
			title: nls.localize2('agentsVoice.startVoiceInChat', "Voice Mode"),
			icon: Codicon.voiceModeCompact,
			precondition: AGENTS_VOICE_ENABLED,
			menu: {
				id: MenuId.ChatExecute,
				when: ContextKeyExpr.and(
					SegmentedVoiceInputModePillInactive,
					AGENTS_VOICE_ENABLED,
					ContextKeyExpr.notEquals(`config.${AgentsVoiceSettingId.ShowButton}`, false),
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					ChatContextKeys.currentlyEditing.negate(),
					AGENTS_VOICE_LISTENING.negate(),
					AGENTS_VOICE_CONNECTING.negate(),
					ChatContextKeys.speechToTextRecording.negate(),
					ChatContextKeys.speechToTextPreparing.negate(),
				),
				group: 'navigation',
				order: -10
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space,
				when: ContextKeyExpr.and(
					SegmentedVoiceInputModePillInactive,
					AGENTS_VOICE_ENABLED,
					ChatContextKeys.inChatInput,
				),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voiceController = accessor.get(IVoiceSessionController);
		const keybindingService = accessor.get(IKeybindingService);
		const handsFree = accessor.get(IConfigurationService).getValue<boolean>('agents.voice.handsFree') === true;
		const omniHasFocus = accessor.get(IChatInputWindowService).hasFocus;
		const activeWindow = getActiveWindow();
		voiceController.setActiveWindow(activeWindow);

		const holdMode = keybindingService.enableKeybindingHoldMode('agentsVoice.startVoiceInChat');

		const currentSession = omniHasFocus
			? undefined
			: await accessor.get(ICommandService).executeCommand<string | undefined>('_chat.voice.getCurrentSession');
		voiceController.setOmniInputActive(omniHasFocus);
		if (omniHasFocus) {
			voiceController.setDraftTarget();
		} else if (currentSession) {
			try {
				const resource = URI.parse(currentSession);
				if (resource.scheme === 'sessions-voice') {
					voiceController.setDraftTarget();
				} else {
					voiceController.setTargetSession(resource);
					voiceController.activateSession(resource);
				}
			} catch {
			}
		}

		const wasConnected = voiceController.isConnected.get();
		if (!wasConnected) {
			await voiceController.connect(activeWindow);
		}

		if (!holdMode && !handsFree && !wasConnected) {
			return;
		}

		voiceController.pttDown();
		if (!holdMode) {
			voiceController.pttUp();
			return;
		}

		await holdMode;
		voiceController.pttUp();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.pttStopInChat',
			title: nls.localize2('agentsVoice.pttStopInChat', "Voice Mode: Stop Recording"),
			icon: Codicon.voiceModeCompact,
			precondition: ContextKeyExpr.and(
				AGENTS_VOICE_ENABLED,
				AGENTS_VOICE_LISTENING.isEqualTo(true),
			),
			menu: {
				id: MenuId.ChatExecute,
				when: ContextKeyExpr.and(
					SegmentedVoiceInputModePillInactive,
					AGENTS_VOICE_ENABLED,
					ContextKeyExpr.notEquals(`config.${AgentsVoiceSettingId.ShowButton}`, false),
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					ChatContextKeys.currentlyEditing.negate(),
					AGENTS_VOICE_LISTENING.isEqualTo(true),
				),
				group: 'navigation',
				order: -10
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voiceController = accessor.get(IVoiceSessionController);
		voiceController.stopListening();
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.disconnect',
			title: nls.localize2('agentsVoice.disconnect', "Disconnect Voice Mode"),
			icon: Codicon.debugDisconnectCompact,
			f1: true,
			precondition: ContextKeyExpr.and(
				AGENTS_VOICE_ENABLED,
				AGENTS_VOICE_CONNECTED.isEqualTo(true),
			),
			menu: {
				id: MenuId.ChatExecute,
				when: ContextKeyExpr.and(
					AGENTS_VOICE_ENABLED,
					ContextKeyExpr.notEquals(`config.${AgentsVoiceSettingId.ShowButton}`, false),
					ChatContextKeys.location.isEqualTo(ChatAgentLocation.Chat),
					ChatContextKeys.currentlyEditing.negate(),
					AGENTS_VOICE_CONNECTED.isEqualTo(true),
					SegmentedVoiceInputModePillInactive,
				),
				group: 'navigation',
				order: -9
			},
			keybinding: {
				weight: KeybindingWeight.EditorContrib - 5,
				primary: KeyCode.Escape,
				when: ContextKeyExpr.and(
					AGENTS_VOICE_ENABLED,
					ChatContextKeys.inChatInput,
					AGENTS_VOICE_CONNECTED.isEqualTo(true),
					ChatContextKeys.hasActiveRequest.negate(),
					EditorContextKeys.hoverVisible.toNegated(),
					EditorContextKeys.hasNonEmptySelection.toNegated(),
					EditorContextKeys.hasMultipleSelections.toNegated(),
				),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voiceController = accessor.get(IVoiceSessionController);
		voiceController.disconnect('explicit');
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.cancelActiveRequest',
			title: nls.localize2('agentsVoice.cancelActiveRequest', "Voice Mode: Cancel Request"),
			f1: false,
			keybinding: {
				weight: KeybindingWeight.EditorContrib - 5,
				primary: KeyCode.Escape,
				when: ContextKeyExpr.and(
					AGENTS_VOICE_ENABLED,
					ChatContextKeys.inChatInput,
					AGENTS_VOICE_CONNECTED.isEqualTo(true),
					ChatContextKeys.hasActiveRequest,
					EditorContextKeys.hoverVisible.toNegated(),
					EditorContextKeys.hasNonEmptySelection.toNegated(),
					EditorContextKeys.hasMultipleSelections.toNegated(),
				),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ICommandService).executeCommand('workbench.action.chat.cancel');
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.openSettings',
			title: nls.localize2('agentsVoice.openSettings', "Voice Mode Settings"),
			f1: true,
			precondition: AGENTS_VOICE_ENABLED,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand('workbench.action.openSettings', { query: 'agents.voice' });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: SHOW_VOICE_MODE_ONBOARDING_COMMAND,
			title: nls.localize2('agentsVoice.showOnboarding', "Voice Mode: Show Introduction"),
			f1: true,
			precondition: AGENTS_VOICE_ENABLED,
		});
	}

	run(accessor: ServicesAccessor): void {
		if (!accessor.get(IVoiceModeOnboardingService).show()) {
			accessor.get(INotificationService).info(nls.localize('agentsVoice.onboardingNeedsChat', "Open a chat to see the Voice Mode introduction."));
		}
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.simulateConnection',
			title: nls.localize2('agentsVoice.simulateConnection', "Voice: Simulate Connection (Dev)"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voiceController = accessor.get(IVoiceSessionController);
		voiceController.simulateConnection();
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.resetOnboarding',
			title: nls.localize2('resetAgentsVoiceOnboarding', "Voice: Reset Onboarding"),
			f1: true,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		storageService.remove(AgentsVoiceStorageKeys.OnboardingCompleted, StorageScope.PROFILE);
		storageService.remove(AgentsVoiceStorageKeys.IntroBannerShown, StorageScope.APPLICATION);
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'agentsVoice.pushToTalk',
			title: nls.localize2('agentsVoicePushToTalk', "Voice Mode: Push to Talk"),
			f1: true,
			precondition: AGENTS_VOICE_ENABLED,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space,
				when: ContextKeyExpr.and(
					AGENTS_VOICE_WIDGET_FOCUSED,
					ContextKeyExpr.not('inputFocus'),
				),
			},
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const voiceController = accessor.get(IVoiceSessionController);
		const keybindingService = accessor.get(IKeybindingService);

		const holdMode = keybindingService.enableKeybindingHoldMode('agentsVoice.pushToTalk');

		if (!voiceController.isConnected.get() && !voiceController.isConnecting.get()) {
			await voiceController.connect(getActiveWindow());
		}
		if (!voiceController.isConnected.get()) {
			return;
		}

		voiceController.pttDown();

		if (!holdMode) {
			voiceController.pttUp();
			return;
		}

		await holdMode;
		voiceController.pttUp();
	}
});



const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'agentsVoice',
	title: nls.localize('agentsVoiceConfigurationTitle', "Voice Mode"),
	type: 'object',
	properties: {
		'agents.voice.enabled': {
			type: 'boolean',
			description: nls.localize('agents.voice.enabled', "Enable the Voice Mode panel in the chat view for voice-driven coding conversations."),
			default: false,
			experiment: {
				mode: 'auto',
			},
			tags: ['experimental'],
			scope: ConfigurationScope.APPLICATION,
			restricted: true,
		},
		[AgentsVoiceSettingId.ShowButton]: {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.showButton', "Controls whether the Voice Mode button is shown in the chat input. When hidden, Voice Mode can still be started with its keyboard shortcut."),
			default: true,
			tags: ['experimental'],
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.backendUrl': {
			type: 'string',
			description: nls.localize('agents.voice.backendUrl', "Voice backend WebSocket URL. Leave empty to use the default hosted backend. Set to e.g. `ws://localhost:8000/api/v1/realtime/voice` to point at a backend running on your machine."),
			default: '',
			scope: ConfigurationScope.APPLICATION,
			included: false,
		},
		'agents.voice.speakResponses': {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.speakResponses', "When enabled, the assistant reads responses aloud. When disabled, responses are not spoken; enable `#agents.voice.showTranscript#` to read them as a text transcript instead."),
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		[VOICE_AGENT_PROGRESS_SETTING]: {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.agentProgress', "Allow Agent mode to speak brief semantic progress updates while it investigates, plans, edits, validates, or recovers from a problem."),
			default: true,
			tags: ['experimental'],
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.voice': {
			type: 'string',
			enum: ['harper_neutral', 'birch_neutral', 'junho_neutral', 'oak_neutral'],
			enumItemLabels: ['Harper', 'Birch', 'Junho', 'Oak'],
			enumDescriptions: [
				nls.localize('agents.voice.voice.harper', "Harper."),
				nls.localize('agents.voice.voice.birch', "Birch."),
				nls.localize('agents.voice.voice.junho', "Junho."),
				nls.localize('agents.voice.voice.oak', "Oak."),
			],
			markdownDescription: nls.localize('agents.voice.voice', "The voice used when the assistant reads responses aloud. Changing this while voice mode is connected takes effect immediately. Use [Voice Mode instructions](command:{0}) to customize Voice Mode behavior and terminology.", CONFIGURE_VOICE_INSTRUCTIONS_ACTION_ID),
			default: 'birch_neutral',
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.language': {
			type: 'string',
			enum: ['auto', 'en', 'de', 'es', 'fr', 'it', 'pt', 'ja', 'ko', 'zh'],
			enumItemLabels: [
				nls.localize('agents.voice.language.auto', "Automatic"),
				nls.localize('agents.voice.language.en', "English"),
				nls.localize('agents.voice.language.de', "German"),
				nls.localize('agents.voice.language.es', "Spanish"),
				nls.localize('agents.voice.language.fr', "French"),
				nls.localize('agents.voice.language.it', "Italian"),
				nls.localize('agents.voice.language.pt', "Portuguese"),
				nls.localize('agents.voice.language.ja', "Japanese"),
				nls.localize('agents.voice.language.ko', "Korean"),
				nls.localize('agents.voice.language.zh', "Chinese"),
			],
			markdownDescription: nls.localize('agents.voice.language', "The language used for speech recognition, dictation, and spoken responses. The selectable languages support native voice output. Automatic uses the configured display language for speech recognition and dictation when supported; otherwise, it follows the system or browser locale. English voice output is used when the detected language does not support native voice output. Changing this while voice mode is connected takes effect immediately."),
			default: 'auto',
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.showTranscript': {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.showTranscript', "Show the voice transcript overlay in the chat input area while voice mode is active. Enable this to read responses as text when `#agents.voice.speakResponses#` is disabled."),
			default: false,
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.liveTranscript': {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.liveTranscript', "Show your speech as a live, word-by-word transcript while you are speaking. When disabled, your transcript appears only once you finish speaking. Requires `#agents.voice.showTranscript#` to be enabled to be visible."),
			default: false,
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.handsFree': {
			type: 'boolean',
			markdownDescription: nls.localize('agents.voice.handsFree', "When enabled, voice mode automatically re-enters listening after the assistant finishes speaking, so you can hold a hands-free back-and-forth conversation. When disabled, you start and end each turn manually, and ending the turn sends it. Turns are not ended automatically on trailing silence or a stop phrase unless {0} or {1} is explicitly configured.", '`#agents.voice.turn.silenceMs#`', '`#agents.voice.turn.stopPhrases#`'),
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.turn.silenceMs': {
			type: 'number',
			markdownDescription: nls.localize('agents.voice.turn.silenceMs', "Trailing silence in milliseconds before the backend ends the turn automatically. Set to `-1` to disable ending the turn on silence, in which case the turn ends only via a stop phrase ({0}) or manually. When enabled, the backend clamps this to its supported range (currently 200-5000 ms) and is the source of truth. When hands-free mode ({1}) is disabled, the turn is not ended on silence by default unless this setting is explicitly configured, so you keep manual control over when a turn is sent.", '`#agents.voice.turn.stopPhrases#`', '`#agents.voice.handsFree#`'),
			default: 800,
			anyOf: [
				{
					const: -1,
					description: nls.localize('agents.voice.turn.silenceMs.disabled', "Do not end the turn on trailing silence."),
				},
				{
					type: 'number',
					minimum: 200,
					maximum: 5000,
				},
			],
			scope: ConfigurationScope.APPLICATION,
		},
		'agents.voice.turn.stopPhrases': {
			type: 'array',
			items: { type: 'string' },
			markdownDescription: nls.localize('agents.voice.turn.stopPhrases', "Phrases that end the turn when spoken at the end of an utterance. Leave empty to disable ending the turn on a stop phrase, in which case the turn ends only on trailing silence ({0}) or manually. The backend strips the matched phrase from the transcript before it reaches the agent. When hands-free mode ({1}) is disabled, stop phrases do not end the turn by default unless this setting is explicitly configured, so you keep manual control over when a turn is sent.", '`#agents.voice.turn.silenceMs#`', '`#agents.voice.handsFree#`'),
			default: ['send it'],
			scope: ConfigurationScope.APPLICATION,
		},
	}
});

Registry.as<IConfigurationMigrationRegistry>(WorkbenchConfigurationExtensions.ConfigurationMigration)
	.registerConfigurationMigrations([{
		key: 'agents.voice.voice',
		includeApplication: true,
		migrateFn: (value: unknown) => ({ value: normalizeAgentsVoiceId(value) }),
	}, {
		key: 'agents.voice.turn.autoEndMode',
		migrateFn: (value: unknown) => {
			const result: ConfigurationKeyValuePairs = [['agents.voice.turn.autoEndMode', { value: undefined }]];
			if (value === 'off' || value === 'vad' || value === 'phrase' || value === 'both') {
				const silenceEnabled = value === 'vad' || value === 'both';
				const phraseEnabled = value === 'phrase' || value === 'both';
				if (!silenceEnabled) {
					result.push(['agents.voice.turn.silenceMs', { value: -1 }]);
				}
				if (!phraseEnabled) {
					result.push(['agents.voice.turn.stopPhrases', { value: [] }]);
				}
			}
			return result;
		}
	}]);
