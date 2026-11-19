/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { Event } from '../../../../base/common/event.js';
import { ChatContextKeys } from '../../chat/common/actions/chatContextKeys.js';

import './agentsVoiceColors.js';

export const AGENTS_VOICE_CONNECTED = new RawContextKey<boolean>('agentsVoiceConnected', false);
export const AGENTS_VOICE_CONNECTING = new RawContextKey<boolean>('agentsVoiceConnecting', false);
export const AGENTS_VOICE_LISTENING = new RawContextKey<boolean>('agentsVoiceListening', false);
export const AGENTS_VOICE_ENTITLED = new RawContextKey<boolean>('agentsVoiceEntitled', false);
export const AGENTS_VOICE_ENABLED = ContextKeyExpr.and(
	ChatContextKeys.enabled,
	ContextKeyExpr.equals('config.agents.voice.enabled', true),
	AGENTS_VOICE_ENTITLED,
)!;

export const enum AgentsVoiceSettingId {
	ShowButton = 'agents.voice.showButton',
}

export const AGENTS_VOICE_WINDOW_DEFAULT_WIDTH = 400;
export const AGENTS_VOICE_WINDOW_DEFAULT_HEIGHT = 70;

export const enum AgentsVoiceStorageKeys {
	WindowOpen = 'agentsVoice.windowOpen',
	WindowBounds = 'agentsVoice.windowBounds',
	TranscriptIndex = 'agentsVoice.transcriptIndex',
	OnboardingCompleted = 'agentsVoice.onboardingCompleted',
	IntroBannerShown = 'agentsVoice.introBannerShown',
	MicrophoneDevice = 'agentsVoice.microphoneDevice',
}

export const IAgentsVoiceWindowService = createDecorator<IAgentsVoiceWindowService>('agentsVoiceWindowService');

export interface IAgentsVoiceWindowService {
	readonly _serviceBrand: undefined;

	readonly isOpen: boolean;

	readonly onDidChangeOpen: Event<boolean>;

	openWindow(): Promise<void>;

	closeWindow(): void;

	toggleWindow(): Promise<void>;
}
