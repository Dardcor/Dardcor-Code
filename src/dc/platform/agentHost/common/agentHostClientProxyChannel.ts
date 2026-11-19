/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { AuthInfo, Credentials, IRequestService } from '../../request/common/request.js';

export const AGENT_HOST_CLIENT_PROXY_CHANNEL = 'agentHostClientProxy';

export interface IAgentHostClientProxyConnection {
	resolveProxy(url: string): Promise<string | undefined>;
	lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined>;
	lookupKerberosAuthorization(url: string): Promise<string | undefined>;
}

export function createAgentHostClientProxyConnection(channel: IChannel): IAgentHostClientProxyConnection {
	return {
		resolveProxy: (url) => channel.call('resolveProxy', { url }) as Promise<string | undefined>,
		lookupAuthorization: authInfo => channel.call('lookupAuthorization', { authInfo }) as Promise<Credentials | undefined>,
		lookupKerberosAuthorization: url => channel.call('lookupKerberosAuthorization', { url }) as Promise<string | undefined>,
	};
}

export class AgentHostClientProxyChannel implements IServerChannel {

	constructor(
		@IRequestService private readonly _requestService: IRequestService,
	) { }

	listen<T>(_ctx: unknown, event: string): Event<T> {
		throw new Error(`No event '${event}' on AgentHostClientProxyChannel`);
	}

	async call<T>(_ctx: unknown, command: string, arg?: unknown): Promise<T> {
		switch (command) {
			case 'resolveProxy': {
				const { url } = arg as { url: string };
				const proxy = await this._requestService.resolveProxy(url);
				return proxy as T;
			}
			case 'lookupAuthorization': {
				const { authInfo } = arg as { authInfo: AuthInfo };
				const credentials = await this._requestService.lookupAuthorization(authInfo);
				return credentials as T;
			}
			case 'lookupKerberosAuthorization': {
				const { url } = arg as { url: string };
				const authorization = await this._requestService.lookupKerberosAuthorization(url);
				return authorization as T;
			}
		}
		throw new Error(`Unknown command '${command}' on AgentHostClientProxyChannel`);
	}
}
