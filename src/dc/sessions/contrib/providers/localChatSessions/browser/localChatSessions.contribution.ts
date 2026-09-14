/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../workbench/common/contributions.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { LocalChatSessionsProvider, LOCAL_SESSION_ENABLED_SETTING } from './localChatSessionsProvider.js';
import { ISessionsProvidersService } from '../../../../services/sessions/browser/sessionsProvidersService.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'sessions',
	properties: {
		[LOCAL_SESSION_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			tags: ['experimental'],
			experiment: { mode: 'startup' },
			description: localize('sessions.chat.localAgent.enabled', "Enable Local VS Code chat sessions in the Agents Window. Reload the window for changes to take effect."),
		},
	},
});

class LocalSessionsProviderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'sessions.localSessionsProvider';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		if (configurationService.getValue<boolean>(LOCAL_SESSION_ENABLED_SETTING) === false) {
			return;
		}

		const provider = this._register(instantiationService.createInstance(LocalChatSessionsProvider));
		this._register(sessionsProvidersService.registerProvider(provider));
	}
}

registerWorkbenchContribution2(LocalSessionsProviderContribution.ID, LocalSessionsProviderContribution, WorkbenchPhase.BlockRestore);

