/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { deriveGitHubEndpoints, gitHubCopilotResource, gitHubRepoResource } from '../../common/githubEndpoints.js';
import { IAgentHostGitHubEndpointService } from '../../node/agentHostGitHubEndpointService.js';

export function createTestGitHubEndpointService(enterpriseUri?: string): IAgentHostGitHubEndpointService {
	const endpoints = deriveGitHubEndpoints(enterpriseUri);
	return {
		_serviceBrand: undefined,
		onDidChange: Event.None,
		getApiBaseUri: () => endpoints.apiBaseUri,
		getGraphQlUri: () => endpoints.graphQlUri,
		getEnterpriseHost: () => endpoints.enterpriseHost,
		getEnterpriseUri: () => enterpriseUri || undefined,
		getCopilotResource: () => gitHubCopilotResource(endpoints),
		getRepoResource: () => gitHubRepoResource(endpoints),
	};
}
