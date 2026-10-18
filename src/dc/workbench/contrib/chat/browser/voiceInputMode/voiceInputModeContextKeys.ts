/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextKeyExpr, ContextKeyExpression } from '../../../../../platform/contextkey/common/contextkey.js';
import { AGENTS_VOICE_CONNECTED, AGENTS_VOICE_ENABLED } from '../../../agentsVoice/common/agentsVoice.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';

const VoiceModeButtonShown = ContextKeyExpr.notEquals('config.agents.voice.showButton', false);
const DictationConfigured = ContextKeyExpr.and(ChatContextKeys.enabled, ContextKeyExpr.has(ChatContextKeys.speechToTextConfigured.key))!;
const DictationButtonShown = ContextKeyExpr.notEquals('config.dictation.showButton', false);
const VisibleVoiceMode = ContextKeyExpr.and(AGENTS_VOICE_ENABLED, VoiceModeButtonShown)!;
const VisibleDictation = ContextKeyExpr.and(DictationConfigured, DictationButtonShown)!;

export const SegmentedVoiceInputModePillActive: ContextKeyExpression = ContextKeyExpr.and(
	VisibleVoiceMode,
	ContextKeyExpr.or(
		VisibleDictation,
		AGENTS_VOICE_CONNECTED,
	),
)!;

export const SegmentedVoiceInputModePillInactive: ContextKeyExpression = SegmentedVoiceInputModePillActive.negate();
