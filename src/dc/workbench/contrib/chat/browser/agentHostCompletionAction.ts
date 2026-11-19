/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { SessionConfigKey } from '../../../../platform/agentHost/common/sessionConfigKeys.js';
import { IAgentHostCompletionAction } from '../../../../platform/agentHost/common/meta/agentCompletionAttachmentMeta.js';
import { isAutoApprovePolicyRestricted } from '../common/agentHostConfigPolicy.js';
import { maybeConfirmElevatedPermissionLevel } from '../common/chatPermissionWarnings.js';
import { ChatConfiguration, ChatPermissionLevel, isChatPermissionLevel } from '../common/constants.js';

export async function applyAgentHostCompletionAction(
	action: IAgentHostCompletionAction,
	dialogService: IDialogService,
	storageService: IStorageService,
	apply: (config: Readonly<Record<string, string>>) => void | Promise<void>,
): Promise<boolean> {
	const config = action.applyConfig;
	if (!config || Object.keys(config).length === 0) {
		return true;
	}

	const elevatedLevel = getElevatedAutoApproveLevel(config[SessionConfigKey.AutoApprove]);
	if (elevatedLevel !== undefined) {
		const confirmed = await maybeConfirmElevatedPermissionLevel(elevatedLevel, dialogService, storageService, {
			defaultSettingKey: ChatConfiguration.DefaultConfiguration,
		});
		if (!confirmed) {
			return false;
		}
	}

	await apply(config);
	return true;
}

function getElevatedAutoApproveLevel(value: string | undefined): ChatPermissionLevel | undefined {
	if (value === undefined || value === ChatPermissionLevel.Default) {
		return undefined;
	}
	if (!isChatPermissionLevel(value)) {
		return undefined;
	}
	return value === ChatPermissionLevel.AutoApprove || value === ChatPermissionLevel.Assisted || value === ChatPermissionLevel.Autopilot ? value : undefined;
}

export function isPolicyBlockedCompletionAction(action: IAgentHostCompletionAction, configurationService: IConfigurationService): boolean {
	return getElevatedAutoApproveLevel(action.applyConfig?.[SessionConfigKey.AutoApprove]) !== undefined
		&& isAutoApprovePolicyRestricted(configurationService);
}
