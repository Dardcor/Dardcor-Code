/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ISessionGitHubState } from './state/sessionState.js';

export const META_GIT_STATE = 'agentHost.git';
export const META_GITHUB_STATE = 'agentHost.github';
export const META_SOURCE_CONTROL_STATE = 'agentHost.sourceControl';

export const GIT_DB_METADATA_KEYS: Record<string, true> = {
	[META_GIT_STATE]: true,
	[META_GITHUB_STATE]: true,
	[META_SOURCE_CONTROL_STATE]: true,
};

export const IAgentHostGitStateService = createDecorator<IAgentHostGitStateService>('agentHostGitStateService');

export interface IAgentHostGitStateService {
	readonly _serviceBrand: undefined;

	readonly onDidRefreshSessionGitState: Event<string>;

	readonly onDidChangeSessionGitHubState: Event<string>;

	refreshSessionGitState(sessionKey: string, workingDirectory?: URI): Promise<void>;

	resolveSessionBaseBranchName(sessionKey: string): Promise<string | undefined>;

	setSessionGitHubState(sessionKey: string, state: ISessionGitHubState): Promise<void>;

	recordSessionMerge(sessionKey: string, commit: string): Promise<void>;

	attachSessionGitHubPullRequest(sessionKey: string, workingDirectory?: URI): Promise<void>;
}
