/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IRelayChannel } from './relayTransport.js';

export const DEV_CONTAINER_AGENT_HOST_CHANNEL = 'devContainerAgentHost';

export interface IDevContainerAgentHostConfig {
	readonly connectionId: string;
	readonly workspaceFolder: string;
	readonly name: string;
}

export interface IDevContainerAgentHostConnectResult {
	readonly connectionId: string;
	readonly address: string;
	readonly name: string;
	readonly remoteWorkspaceFolder: string;
}

export interface IDevContainerAgentHostOutput {
	readonly connectionId: string;
	readonly data: string;
}

export const IDevContainerAgentHostMainService = createDecorator<IDevContainerAgentHostMainService>('devContainerAgentHostMainService');

export interface IDevContainerAgentHostMainService extends IRelayChannel {
	readonly _serviceBrand: undefined;

	readonly onDidCloseConnection: Event<string>;
	readonly onDidOutput: Event<IDevContainerAgentHostOutput>;

	isDockerAvailable(): Promise<boolean>;
	connect(config: IDevContainerAgentHostConfig): Promise<IDevContainerAgentHostConnectResult>;
	disconnect(connectionId: string): Promise<void>;
}
