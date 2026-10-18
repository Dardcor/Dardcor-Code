/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IStorageService, StorageScope } from '../../../../../../platform/storage/common/storage.js';
import { IChatWidgetService } from '../../../../chat/browser/chat.js';
import { TerminalToolConfirmationStorageKeys } from '../../../../chat/browser/widget/chatContentParts/toolInvocationParts/chatTerminalToolConfirmationSubPart.js';
import { IChatService } from '../../../../chat/common/chatService/chatService.js';
import { ChatConfiguration, isAutoApproveLevel } from '../../../../chat/common/constants.js';
import { TerminalChatAgentToolsSettingId } from '../../common/terminalChatAgentToolsConfiguration.js';

export function isSessionAutoApproveLevel(
	chatSessionResource: URI,
	configurationService: IConfigurationService,
	chatWidgetService: IChatWidgetService,
	chatService: IChatService,
): boolean {
	const inspected = configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove);
	if (inspected.policyValue === false) {
		return false;
	}
	const widget = chatWidgetService.getWidgetBySessionResource(chatSessionResource)
		?? chatWidgetService.lastFocusedWidget;
	if (widget && isAutoApproveLevel(widget.input.currentModeInfo.permissionLevel)) {
		return true;
	}
	const model = chatService.getSession(chatSessionResource);
	const request = model?.getRequests().at(-1);
	return isAutoApproveLevel(request?.modeInfo?.permissionLevel);
}

export function isToolEligibleForTerminalAutoApproval(
	toolReferenceName: string,
	configurationService: IConfigurationService,
	legacyToolReferenceFullNames?: string[],
): boolean {
	const config = configurationService.getValue<Record<string, boolean>>(ChatConfiguration.EligibleForAutoApproval);
	if (config && typeof config === 'object') {
		if (Object.prototype.hasOwnProperty.call(config, toolReferenceName)) {
			return config[toolReferenceName];
		}
		if (legacyToolReferenceFullNames) {
			for (const legacyName of legacyToolReferenceFullNames) {
				if (Object.prototype.hasOwnProperty.call(config, legacyName)) {
					return config[legacyName];
				}
			}
		}
	}
	return true;
}

export function isTerminalAutoApproveAllowed(
	toolReferenceName: string,
	configurationService: IConfigurationService,
	storageService: IStorageService,
	legacyToolReferenceFullNames?: string[],
): boolean {
	const isEligible = isToolEligibleForTerminalAutoApproval(toolReferenceName, configurationService, legacyToolReferenceFullNames);
	const isAutoApproveEnabled = configurationService.getValue(TerminalChatAgentToolsSettingId.EnableAutoApprove) === true;
	const isAutoApproveWarningAccepted = storageService.getBoolean(TerminalToolConfirmationStorageKeys.TerminalAutoApproveWarningAccepted, StorageScope.APPLICATION, false);
	return isEligible && isAutoApproveEnabled && isAutoApproveWarningAccepted;
}
