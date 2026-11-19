/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import type { IDisposable } from '../../../base/common/lifecycle.js';
import type { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { IAgentConnection } from './agentService.js';
import type { DefaultChangesetKind } from './changesetUri.js';

export const LOCAL_AGENT_HOST_SCHEME_PREFIX = 'agent-host-';

export const AMBIENT_AGENT_HOST_AUTHORITY = 'local';

export interface IAgentHostConnectionInfo {
	readonly authority: string;
	readonly address: string | undefined;
	readonly name: string;
	readonly isAmbient: boolean;
	readonly connection: IAgentConnection | undefined;
}

export interface IAgentHostSessionIdentity {
	readonly connectionAuthority: string;
	readonly backendSession: URI;
	readonly defaultChangesetKind?: DefaultChangesetKind;
}

export interface IAgentHostSessionResolution extends IAgentHostSessionIdentity {
	readonly connection: IAgentConnection;
}

export interface IAgentHostSessionResolutionPolicy {
	readonly sessionSchemeAlias?: IAgentHostSessionSchemeAlias;
	readonly defaultChangesetKind?: DefaultChangesetKind;
}

export interface IAgentHostSessionSchemeAlias {
	readonly ui: string;
	readonly backend: string;
}

export const IAgentHostConnectionsService = createDecorator<IAgentHostConnectionsService>('agentHostConnectionsService');

export interface IAgentHostConnectionsService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;

	readonly onDidChangeSessionResolution: Event<void>;

	readonly connections: readonly IAgentHostConnectionInfo[];

	readonly ambientConnection: IAgentConnection;

	getConnectionByAuthority(authority: string): IAgentConnection | undefined;

	getConnectionByAddress(address: string): IAgentConnection | undefined;

	registerSessionResolutionPolicy(authority: string, policy: IAgentHostSessionResolutionPolicy): IDisposable;

	resolveSessionResourceIdentity(sessionResource: URI): IAgentHostSessionIdentity | undefined;

	resolveSessionResource(sessionResource: URI): IAgentHostSessionResolution | undefined;
}
