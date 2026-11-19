/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IAddress } from './remoteAgentConnection.js';

export const ISharedProcessTunnelService = createDecorator<ISharedProcessTunnelService>('sharedProcessTunnelService');

export const ipcSharedProcessTunnelChannelName = 'sharedProcessTunnel';

export interface ISharedProcessTunnel {
	tunnelLocalPort: number | undefined;
	localAddress: string;
}

export interface ISharedProcessTunnelService {
	readonly _serviceBrand: undefined;

	createTunnel(): Promise<{ id: string }>;
	startTunnel(authority: string, id: string, tunnelRemoteHost: string, tunnelRemotePort: number, tunnelLocalHost: string, tunnelLocalPort: number | undefined, elevateIfNeeded: boolean | undefined): Promise<ISharedProcessTunnel>;
	setAddress(id: string, address: IAddress): Promise<void>;
	destroyTunnel(id: string): Promise<void>;
}
