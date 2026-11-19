/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { IObservable } from '../../../base/common/observable.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import {
	DirectoryEntry,
	ResourceCopyParams, ResourceDeleteParams, ResourceMkdirParams, ResourceMoveParams,
	ResourceRequestParams, ResourceResolveParams, ResourceResolveResult, ResourceWriteParams,
} from './state/protocol/commands.js';

export const LOCAL_AGENT_HOST_RESOURCE_IDENTITY: unique symbol = Symbol('localAgentHostResourceIdentity');

export type AgentHostResourceIdentity = string | typeof LOCAL_AGENT_HOST_RESOURCE_IDENTITY;

export const AgentHostLocalFilePermissionsSettingId = 'chat.agentHost.localFilePermissions';

export const enum AgentHostAccessMode {
	Read = 'r',
	ReadWrite = 'rw',
}

export type AgentHostPermissionGrant = AgentHostAccessMode | {
	readonly mode: AgentHostAccessMode;
	readonly lexicalUri: string;
};

export type AgentHostPermissionsSetting = Record<string, Record<string, AgentHostPermissionGrant>>;

export const enum AgentHostPermissionMode {
	Read = 'read',
	Write = 'write',
}

export interface IPendingResourceRequest {
	readonly id: string;
	readonly address: string;
	readonly uri: URI;
	readonly mode: AgentHostPermissionMode;
	allowAlways(): void;
	allow(): void;
	deny(): void;
}

export class AgentHostResourcePermissionError extends Error {
	constructor(public readonly request: ResourceRequestParams | undefined) {
		super(request
			? `Access to ${request.uri} is not granted.`
			: 'Access to the requested resource is not granted.');
		this.name = 'AgentHostResourcePermissionError';
	}
}

export interface IResourceReadResult {
	readonly bytes: VSBuffer;
}

export interface IResourceListResult {
	readonly entries: readonly DirectoryEntry[];
}

export const IAgentHostResourceService = createDecorator<IAgentHostResourceService>('agentHostResourceService');

export interface IAgentHostResourceService {
	readonly _serviceBrand: undefined;


	list(identity: AgentHostResourceIdentity, uri: URI): Promise<IResourceListResult>;
	read(identity: AgentHostResourceIdentity, uri: URI): Promise<IResourceReadResult>;
	write(identity: AgentHostResourceIdentity, params: ResourceWriteParams): Promise<void>;
	del(identity: AgentHostResourceIdentity, params: ResourceDeleteParams): Promise<void>;
	move(identity: AgentHostResourceIdentity, params: ResourceMoveParams): Promise<void>;
	copy(identity: AgentHostResourceIdentity, params: ResourceCopyParams): Promise<void>;
	resolve(identity: AgentHostResourceIdentity, params: ResourceResolveParams): Promise<ResourceResolveResult>;
	mkdir(identity: AgentHostResourceIdentity, params: ResourceMkdirParams): Promise<void>;


	check(identity: AgentHostResourceIdentity, uri: URI, mode: AgentHostPermissionMode): Promise<boolean>;

	request(identity: AgentHostResourceIdentity, params: ResourceRequestParams): Promise<void>;

	pendingFor(address: string): IObservable<readonly IPendingResourceRequest[]>;

	readonly allPending: IObservable<readonly IPendingResourceRequest[]>;

	findPending(id: string): IPendingResourceRequest | undefined;


	grantImplicitRead(identity: AgentHostResourceIdentity, uri: URI): IDisposable;

	connectionClosed(identity: AgentHostResourceIdentity): void;
}
