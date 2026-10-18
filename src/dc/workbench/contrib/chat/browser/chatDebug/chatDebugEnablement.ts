/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { AgentHostAhpJsonlLoggingSettingId } from '../../../../../platform/agentHost/common/agentService.js';
import { defaultButtonStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';
import { AgentHostAgentDebugLogEnabledSettingId, AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING } from '../../common/promptSyntax/promptTypes.js';
import { isAgentHostSession } from './agentHostLogSources.js';

const $ = DOM.$;

export function getChatDebugLoggingSettingId(sessionResource: URI | undefined): string {
	return isAgentHostSession(sessionResource)
		? AgentHostAgentDebugLogEnabledSettingId
		: AGENT_DEBUG_LOG_FILE_LOGGING_ENABLED_SETTING;
}

export function isChatDebugLoggingEnabledForSession(configurationService: IConfigurationService, sessionResource: URI | undefined): boolean {
	return configurationService.getValue<boolean>(getChatDebugLoggingSettingId(sessionResource));
}

function renderEnableSettingMessage(
	container: HTMLElement,
	settingId: string,
	message: string,
	preferencesService: IPreferencesService,
	disposables: DisposableStore,
): void {
	const wrapper = DOM.append(container, $('.chat-debug-logging-disabled'));
	DOM.append(wrapper, $('p.chat-debug-logging-disabled-message', undefined, message));

	const enableButton = disposables.add(new Button(wrapper, { ...defaultButtonStyles, secondary: true }));
	enableButton.element.style.width = 'auto';
	enableButton.label = localize('chatDebug.openSetting', "Enable in Settings");
	disposables.add(enableButton.onDidClick(() => {
		preferencesService.openSettings({ jsonEditor: false, query: settingId });
	}));
}

export function renderChatDebugLoggingDisabledMessage(
	container: HTMLElement,
	sessionResource: URI | undefined,
	preferencesService: IPreferencesService,
	disposables: DisposableStore,
): void {
	renderEnableSettingMessage(
		container,
		getChatDebugLoggingSettingId(sessionResource),
		localize('chatDebug.loggingDisabled', "Agent debug logging is turned off. Enable it to capture and view debug logs for this session."),
		preferencesService,
		disposables,
	);
}

export function isWireLogLoggingEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(AgentHostAhpJsonlLoggingSettingId);
}

export function renderWireLogLoggingDisabledMessage(
	container: HTMLElement,
	preferencesService: IPreferencesService,
	disposables: DisposableStore,
): void {
	renderEnableSettingMessage(
		container,
		AgentHostAhpJsonlLoggingSettingId,
		localize('chatDebug.wireLogLoggingDisabled', "AHP logging is turned off. Enable it and reproduce the issue to capture and view client↔host protocol frames for this session."),
		preferencesService,
		disposables,
	);
}
