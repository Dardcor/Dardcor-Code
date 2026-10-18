/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

export const CHAT_AUTOMATIONS_ENABLED_SETTING = 'chat.automations.enabled';

export const CHAT_AUTOMATIONS_RUN_TIMEOUT_MINUTES_SETTING = 'chat.automations.runTimeoutMinutes';

export const DEFAULT_AUTOMATIONS_RUN_TIMEOUT_MINUTES = 30;

export const ChatAutomationsEnabledContext = new RawContextKey<boolean>('chatAutomationsEnabled', false, {
	type: 'boolean',
	description: 'True when the chat Automations feature is enabled via the chat.automations.enabled setting.',
});
