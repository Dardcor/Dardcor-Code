/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { IRelayMessage } from './relayTransport.js';

export const WSL_REMOTE_AGENT_HOST_CHANNEL = 'wslRemoteAgentHost';

export const WSL_INSTALL_DOCS_URL = 'https://www.dardcor-code.web.id/docs/remote/wsl';

export const WSL_ADDRESS_PREFIX = 'wsl:';

export const WslAutoStartSettingId = 'chat.agentHost.wsl.autoStart';

export interface IWSLDistro {
	readonly name: string;
	readonly isDefault: boolean;
	readonly isRunning: boolean;
	readonly version: 2;
}

export interface IWSLAgentHostConfig {
	readonly distro: string;
	readonly name: string;
	readonly remoteAgentHostCommand?: string;
	readonly userInitiated?: boolean;
}

export interface IWSLConnectProgress {
	readonly connectionKey: string;
	readonly message: string;
}

export interface IWSLConnectResult {
	readonly connectionId: string;
	readonly address: string;
	readonly distro: string;
	readonly name: string;
	readonly connectionToken: string | undefined;
}

export interface IWSLAgentHostConnection extends IDisposable {
	readonly distro: string;
	readonly localAddress: string;
	readonly name: string;
	readonly onDidClose: Event<void>;
}

export interface IWSLCachedDistro {
	readonly distro: string;
	readonly name: string;
}

export const IWSLRemoteAgentHostService = createDecorator<IWSLRemoteAgentHostService>('wslRemoteAgentHostService');

export interface IWSLRemoteAgentHostService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;
	readonly onDidReportConnectProgress: Event<IWSLConnectProgress>;
	readonly connections: readonly IWSLAgentHostConnection[];

	isWSLAvailable(): Promise<boolean>;
	listDistros(): Promise<IWSLDistro[]>;
	listRunningDistros(): Promise<string[]>;
	connect(config: IWSLAgentHostConfig): Promise<IWSLAgentHostConnection>;
	disconnect(distro: string): Promise<void>;
	reconnect(distro: string, name: string, userInitiated?: boolean): Promise<IWSLAgentHostConnection>;
	getCachedDistros(): readonly IWSLCachedDistro[];
}

export const IWSLRemoteAgentHostMainService = createDecorator<IWSLRemoteAgentHostMainService>('wslRemoteAgentHostMainService');

export interface IWSLRemoteAgentHostMainService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeConnections: Event<void>;
	readonly onDidCloseConnection: Event<string >;
	readonly onDidReportConnectProgress: Event<IWSLConnectProgress>;

	readonly onDidRelayMessage: Event<IRelayMessage>;
	readonly onDidRelayClose: Event<string >;
	relaySend(connectionId: string, message: string): Promise<void>;

	isWSLAvailable(): Promise<boolean>;
	listDistros(): Promise<IWSLDistro[]>;
	listRunningDistros(): Promise<string[]>;
	connect(config: IWSLAgentHostConfig): Promise<IWSLConnectResult>;
	disconnect(distro: string): Promise<void>;
	reconnect(distro: string, name: string, remoteAgentHostCommand?: string, userInitiated?: boolean): Promise<IWSLConnectResult>;
}
