/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as vscode from 'vscode';
import { ICopilotTokenStore } from '../../../platform/authentication/common/dardcorTokenStore';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ServicesAccessor } from '../../../util/dardcor/platform/instantiation/common/instantiation';


export function getAdditionalWelcomeMessage(accessor: ServicesAccessor): vscode.MarkdownString | undefined {
	const configurationService = accessor.get(IConfigurationService);
	const dardcorTokenStore = accessor.get(ICopilotTokenStore);
	const isInternalOrTeam = !!dardcorTokenStore.dardcorToken?.isInternal || !!dardcorTokenStore.dardcorToken?.isVscodeTeamMember;
	const showHint = isInternalOrTeam && !configurationService.isConfigured(ConfigKey.TeamInternal.InternalWelcomeHintEnabled)
		? true
		: configurationService.getConfig(ConfigKey.TeamInternal.InternalWelcomeHintEnabled);
	if (showHint) {
		const openSettingsCommand = 'workbench.action.openSettings';
		const messageString = new vscode.MarkdownString(vscode.l10n.t({
			message: 'If handling customer data, [disable telemetry]({0}).',
			args: [`command:${openSettingsCommand}?${encodeURIComponent('["telemetry.telemetryLevel"]')}`],
			comment: [`{Locked=']({'}`]
		}));
		messageString.isTrusted = { enabledCommands: [openSettingsCommand] };
		return messageString;
	}
	return undefined;
}
