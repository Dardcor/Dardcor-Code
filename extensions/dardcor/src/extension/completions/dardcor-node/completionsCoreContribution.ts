/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, languages } from 'vscode';
import { Disposable } from '../../../util/dardcor/base/common/lifecycle';
import { autorun } from '../../../util/dardcor/base/common/observableInternal';
import { registerUnificationCommands } from '../../completions-core/dardcor-node/completionsServiceBridges';
import { IDardcorInlineCompletionItemProviderService } from '../common/dardcorInlineCompletionItemProviderService';
import { unificationStateObservable } from './completionsUnificationContribution';

export class CompletionsCoreContribution extends Disposable {

	constructor(
		@IDardcorInlineCompletionItemProviderService _dardcorInlineCompletionItemProviderService: IDardcorInlineCompletionItemProviderService
	) {
		super();

		const unificationState = unificationStateObservable(this);

		this._register(autorun(reader => {
			const unificationStateValue = unificationState.read(reader);
			const extensionUnification = unificationStateValue?.extensionUnification ?? false;

			const provider = _dardcorInlineCompletionItemProviderService.getOrCreateProvider();
			reader.store.add(languages.registerInlineCompletionItemProvider(
				{ pattern: '**' },
				provider,
				{
					debounceDelayMs: 0,
					excludes: ['github.dardcor'],
					groupId: 'completions'
				}
			));

			void commands.executeCommand('setContext', 'github.dardcor.extensionUnification.activated', extensionUnification);

			if (extensionUnification) {
				const completionsInstaService = _dardcorInlineCompletionItemProviderService.getOrCreateInstantiationService();
				reader.store.add(completionsInstaService.invokeFunction(registerUnificationCommands));
			}
		}));

		void commands.executeCommand('setContext', 'github.dardcor.activated', true);
	}
}
