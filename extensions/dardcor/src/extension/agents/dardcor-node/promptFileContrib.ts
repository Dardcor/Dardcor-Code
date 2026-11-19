/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { combinedDisposable, Disposable, MutableDisposable } from '../../../util/dardcor/base/common/lifecycle';
import { SyncDescriptor } from '../../../util/dardcor/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { IExtensionContribution } from '../../common/contributions';
import { AskAgentProvider } from './askAgentProvider';
import { ExploreAgentProvider } from './exploreAgentProvider';
import { GitHubOrgCustomAgentProvider } from './githubOrgCustomAgentProvider';
import { GitHubOrgInstructionsProvider } from './githubOrgInstructionsProvider';
import { PlanAgentProvider } from './planAgentProvider';

export class PromptFileContribution extends Disposable implements IExtensionContribution {
	readonly id = 'PromptFiles';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
	) {
		super();

		if ('registerCustomAgentProvider' in vscode.chat) {
			if (configurationService.getConfig(ConfigKey.EnableOrganizationCustomAgents)) {
				const githubOrgAgentProvider: vscode.ChatCustomAgentProvider = instantiationService.createInstance(new SyncDescriptor(GitHubOrgCustomAgentProvider));
				this._register(vscode.chat.registerCustomAgentProvider(githubOrgAgentProvider));
			}

			const planProvider = instantiationService.createInstance(PlanAgentProvider);
			this._register(vscode.chat.registerCustomAgentProvider(planProvider));

			const askProvider = instantiationService.createInstance(AskAgentProvider);
			this._register(vscode.chat.registerCustomAgentProvider(askProvider));

			const exploreProviderRegistration = this._register(new MutableDisposable<vscode.Disposable>());
			const updateExploreProvider = () => {
				const isEnabled = configurationService.getExperimentBasedConfig(ConfigKey.ExploreAgentEnabled, experimentationService);
				if (isEnabled) {
					if (!exploreProviderRegistration.value) {
						const provider = instantiationService.createInstance(ExploreAgentProvider);
						const registration = vscode.chat.registerCustomAgentProvider(provider);
						exploreProviderRegistration.value = combinedDisposable(registration, provider);
					}
				} else {
					exploreProviderRegistration.clear();
				}
			};
			updateExploreProvider();
			this._register(configurationService.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration(ConfigKey.ExploreAgentEnabled.fullyQualifiedId)) {
					updateExploreProvider();
				}
			}));
		}

		if ('registerInstructionsProvider' in vscode.chat) {
			if (configurationService.getConfig(ConfigKey.EnableOrganizationInstructions)) {
				const githubOrgInstructionsProvider: vscode.ChatInstructionsProvider = instantiationService.createInstance(new SyncDescriptor(GitHubOrgInstructionsProvider));
				this._register(vscode.chat.registerInstructionsProvider(githubOrgInstructionsProvider));
			}
		}
	}
}
