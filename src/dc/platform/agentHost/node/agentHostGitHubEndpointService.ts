/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { AgentHostConfigKey, agentHostCustomizationConfigSchema } from '../common/agentHostCustomizationConfig.js';
import { deriveGitHubEndpoints, gitHubCopilotResource, gitHubRepoResource, IGitHubEndpoints } from '../common/githubEndpoints.js';
import { ProtectedResourceMetadata } from '../common/state/protocol/state.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';

export const IAgentHostGitHubEndpointService = createDecorator<IAgentHostGitHubEndpointService>('agentHostGitHubEndpointService');

export interface IAgentHostGitHubEndpointService {
	readonly _serviceBrand: undefined;

	readonly onDidChange: Event<void>;

	getCopilotResource(): ProtectedResourceMetadata;

	getRepoResource(): ProtectedResourceMetadata;

	getApiBaseUri(): string;

	getGraphQlUri(): string;

	getEnterpriseHost(): string | undefined;

	getEnterpriseUri(): string | undefined;
}

export class AgentHostGitHubEndpointService extends Disposable implements IAgentHostGitHubEndpointService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private _endpoints: IGitHubEndpoints;
	private _enterpriseUri: string | undefined;

	constructor(
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		const resolved = this._resolve();
		this._endpoints = resolved.endpoints;
		this._enterpriseUri = resolved.enterpriseUri;
		this._register(this._configurationService.onDidRootConfigChange(() => {
			const next = this._resolve();
			if (next.endpoints.apiBaseUri === this._endpoints.apiBaseUri
				&& next.endpoints.graphQlUri === this._endpoints.graphQlUri
				&& next.endpoints.oauthServer === this._endpoints.oauthServer) {
				return;
			}
			this._logService.info(`[AgentHost] GitHub endpoints changed (api=${next.endpoints.apiBaseUri})`);
			this._endpoints = next.endpoints;
			this._enterpriseUri = next.enterpriseUri;
			this._onDidChange.fire();
		}));
	}

	private _resolve(): { endpoints: IGitHubEndpoints; enterpriseUri: string | undefined } {
		const enterpriseUri = this._configurationService.getRootValue(agentHostCustomizationConfigSchema, AgentHostConfigKey.GithubEnterpriseUri);
		return { endpoints: deriveGitHubEndpoints(enterpriseUri), enterpriseUri: enterpriseUri || undefined };
	}

	getApiBaseUri(): string {
		return this._endpoints.apiBaseUri;
	}

	getGraphQlUri(): string {
		return this._endpoints.graphQlUri;
	}

	getEnterpriseHost(): string | undefined {
		return this._endpoints.enterpriseHost;
	}

	getEnterpriseUri(): string | undefined {
		return this._enterpriseUri;
	}

	getCopilotResource(): ProtectedResourceMetadata {
		return gitHubCopilotResource(this._endpoints);
	}

	getRepoResource(): ProtectedResourceMetadata {
		return gitHubRepoResource(this._endpoints);
	}
}
