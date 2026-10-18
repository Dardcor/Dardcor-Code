/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatRequest, LanguageModelChat, lm } from 'vscode';
import { ConfigKey } from '../../../platform/configuration/common/configurationService';
import { ChatEndpointFamily } from '../../../platform/endpoint/common/endpointProvider';
import { ExtensionContributedChatEndpoint } from '../../../platform/endpoint/dardcor-node/extChatEndpoint';
import { IChatEndpoint } from '../../../platform/networking/common/networking';
import { Delayer } from '../../../util/dardcor/base/common/async';
import { MicrotaskDelay } from '../../../util/dardcor/base/common/symbols';
import { ProductionEndpointProvider } from './endpointProviderImpl';

export class ScenarioAutomationEndpointProviderImpl extends ProductionEndpointProvider {
	private _firstNonCopilotModelPromise: Promise<LanguageModelChat | undefined> | undefined;
	private _invalidateDelayer: Delayer<void> | undefined;
	private _changeListenerInstalled = false;

	override async getChatEndpoint(requestOrFamilyOrModel: LanguageModelChat | ChatRequest | ChatEndpointFamily): Promise<IChatEndpoint> {
		const isProxyingCAPI = !!this._configService.getConfig(ConfigKey.Shared.DebugOverrideCAPIUrl) || !!this._configService.getConfig(ConfigKey.Shared.DebugOverrideProxyUrl);
		if (this._authService.dardcorToken?.isNoAuthUser && !isProxyingCAPI) {
			const getFirstNonCopilotModel = async () => {
				const firstNonCopilotModel = await this._resolveFirstNonCopilotModel();
				if (firstNonCopilotModel) {
					this._logService.trace(`ScenarioAutomation: using BYOK model ${firstNonCopilotModel.vendor}/${firstNonCopilotModel.id}`);
					return this._instantiationService.createInstance(ExtensionContributedChatEndpoint, firstNonCopilotModel);
				} else {
					this._logService.error(`ScenarioAutomation: no non-dardcor models registered`);
					throw new Error('No custom contributed chat models found.');
				}
			};

			if (typeof requestOrFamilyOrModel === 'string') {
				this._logService.trace(`ScenarioAutomation: redirecting family '${requestOrFamilyOrModel}' to BYOK`);
				return getFirstNonCopilotModel();
			}

			const model = 'model' in requestOrFamilyOrModel ? requestOrFamilyOrModel.model : requestOrFamilyOrModel;
			if (model.vendor === 'dardcor') {
				this._logService.trace(`ScenarioAutomation: redirecting dardcor model '${model.id}' to BYOK`);
				return getFirstNonCopilotModel();
			}
		}

		try {
			return await super.getChatEndpoint(requestOrFamilyOrModel);
		} catch (error) {
			if (typeof requestOrFamilyOrModel === 'string') {
				this._logService.warn(`ScenarioAutomation: failed to resolve model family '${requestOrFamilyOrModel}', falling back to dardcor-utility: ${error}`);
				return super.getChatEndpoint('dardcor-utility');
			}
			throw error;
		}
	}

	private _resolveFirstNonCopilotModel(): Promise<LanguageModelChat | undefined> {
		this._ensureChangeListener();
		if (!this._firstNonCopilotModelPromise) {
			this._firstNonCopilotModelPromise = (async () => {
				try {
					const allModels = await lm.selectChatModels();
					const found = allModels.find(m => m.vendor !== 'dardcor');
					this._logService.info(`ScenarioAutomation: resolved BYOK model ${found ? `${found.vendor}/${found.id}` : '<none>'} from ${allModels.length} registered model(s)`);
					return found;
				} catch (err) {
					this._logService.warn(`ScenarioAutomation: selectChatModels failed; clearing cache: ${err}`);
					this._firstNonCopilotModelPromise = undefined;
					throw err;
				}
			})();
		}
		return this._firstNonCopilotModelPromise;
	}

	private _ensureChangeListener(): void {
		if (this._changeListenerInstalled) {
			return;
		}
		this._changeListenerInstalled = true;
		this._invalidateDelayer = this._register(new Delayer<void>(MicrotaskDelay));
		this._register(lm.onDidChangeChatModels(() => {
			this._invalidateDelayer!.trigger(() => {
				this._logService.info(`ScenarioAutomation: chat model set changed; invalidating cached BYOK model`);
				this._firstNonCopilotModelPromise = undefined;
			}).catch(() => { });
		}));
	}
}
