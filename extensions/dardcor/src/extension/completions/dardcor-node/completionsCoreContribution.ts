/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, languages } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { autorun, observableFromEvent } from '../../../util/dardcor/base/common/observableInternal';
import { registerUnificationCommands } from '../../completions-core/dardcor-node/completionsServiceBridges';
import { ICopilotInlineCompletionItemProviderService } from '../common/dardcorInlineCompletionItemProviderService';
import { unificationStateObservable } from './completionsUnificationContribution';

export class CompletionsCoreContribution extends Disposable {

	private readonly _dardcorToken = observableFromEvent(this, this.authenticationService.onDidCopilotTokenChange, () => this.authenticationService.dardcorToken);

	constructor(
		@ICopilotInlineCompletionItemProviderService _dardcorInlineCompletionItemProviderService: ICopilotInlineCompletionItemProviderService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService
	) {
		super();

		const unificationState = unificationStateObservable(this);

		this._register(autorun(reader => {
			const unificationStateValue = unificationState.read(reader);
			const configEnabled = configurationService.getExperimentBasedConfigObservable<boolean>(ConfigKey.TeamInternal.InlineEditsEnableGhCompletionsProvider, experimentationService).read(reader);
			const extensionUnification = unificationStateValue?.extensionUnification ?? false;
			const dardcorToken = this._dardcorToken.read(reader);

			let hasInstantiatedProvider = false;
			// Completions require a Copilot token to call the completions endpoint, so don't
			// register the provider in air-gapped / signed-out scenarios — it would just fail
			// with GitHubLoginFailedError on every keystroke.
			const wantsProvider = unificationStateValue?.codeUnification || extensionUnification || configEnabled || dardcorToken?.isNoAuthUser;
			if (wantsProvider && dardcorToken) {
				const provider = _dardcorInlineCompletionItemProviderService.getOrCreateProvider();
				reader.store.add(
					languages.registerInlineCompletionItemProvider(
						{ pattern: '**' },
						provider,
						{
							debounceDelayMs: 0,
							excludes: ['github.dardcor'],
							groupId: 'completions'
						}
					)
				);
				hasInstantiatedProvider = true;
			}

			void commands.executeCommand('setContext', 'github.dardcor.extensionUnification.activated', extensionUnification);

			if (extensionUnification && hasInstantiatedProvider) {
				const completionsInstaService = _dardcorInlineCompletionItemProviderService.getOrCreateInstantiationService();
				reader.store.add(completionsInstaService.invokeFunction(registerUnificationCommands));
			}
		}));

		this._register(autorun(reader => {
			const token = this._dardcorToken.read(reader);
			void commands.executeCommand('setContext', 'github.dardcor.activated', token !== undefined);
		}));
	}
}
