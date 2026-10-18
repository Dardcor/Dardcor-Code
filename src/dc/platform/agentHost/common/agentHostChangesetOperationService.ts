/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { ChangesetKind } from './changesetUri.js';
import type { InvokeChangesetOperationParams, InvokeChangesetOperationResult } from './state/protocol/channels-changeset/commands.js';
import type { ChangesetOperation, ISessionGitHubState, ISessionGitState, URI } from './state/sessionState.js';

export const IAgentHostChangesetOperationService = createDecorator<IAgentHostChangesetOperationService>('agentHostChangesetOperationService');

export const AGENT_HOST_MERGE_CHANGESET_OPERATION_ID = 'merge';
export const AGENT_HOST_CHECKOUT_CHANGESET_OPERATION_ID = 'checkout';
export const AGENT_HOST_COMMIT_CHANGESET_OPERATION_ID = 'commit';
export const AGENT_HOST_SYNC_CHANGESET_OPERATION_ID = 'sync';

export const AgentHostPullRequestOperationId = {
	MarkReady: 'pr-mark-ready',
	MarkReadyWithAgentMerge: 'pr-mark-ready-with-agent-merge',
	Merge: 'pr-merge',
	EnableAutoMerge: 'pr-enable-auto-merge',
	DisableAutoMerge: 'pr-disable-auto-merge',
} as const;

export const AGENT_HOST_PULL_REQUEST_OPERATION_IDS: ReadonlySet<string> = new Set(Object.values(AgentHostPullRequestOperationId));

export const AGENT_HOST_AUTO_MERGE_OPERATION_IDS: ReadonlySet<string> = new Set([
	AgentHostPullRequestOperationId.EnableAutoMerge,
	AgentHostPullRequestOperationId.DisableAutoMerge,
]);

export interface IChangesetOperationHandler {
	invoke(params: InvokeChangesetOperationParams, token: CancellationToken): Promise<InvokeChangesetOperationResult>;
}

export interface IChangesetOperationContext {
	readonly sessionKey: string;
	readonly changesetUri: URI;
	readonly changesetKind: ChangesetKind;
	readonly gitState?: ISessionGitState;
	readonly gitHubState?: ISessionGitHubState;
}

export interface IChangesetOperationRegistry {
	registerChangesetOperationHandler(operationId: string, handler: IChangesetOperationHandler): IDisposable;
	onDidChangeOperations(sessionKey: string): void;
	refreshSessionGitState(sessionKey: string): Promise<void>;
}

export interface IChangesetOperationContribution extends IDisposable {
	registerHandlers(registry: IChangesetOperationRegistry): IDisposable;
	getOperations(context: IChangesetOperationContext): readonly ChangesetOperation[] | undefined;
}

export interface IAgentHostChangesetOperationService extends IDisposable {
	readonly _serviceBrand: undefined;

	registerContribution(contribution: IChangesetOperationContribution): IDisposable;
	updateOperations(sessionKey: string, changeset?: string, gitState?: ISessionGitState, gitHubState?: ISessionGitHubState): void;

	getOperations(sessionKey: string, changeset?: string, gitState?: ISessionGitState, gitHubState?: ISessionGitHubState): readonly ChangesetOperation[] | undefined;

	invokeChangesetOperation(params: InvokeChangesetOperationParams): Promise<InvokeChangesetOperationResult>;
}
