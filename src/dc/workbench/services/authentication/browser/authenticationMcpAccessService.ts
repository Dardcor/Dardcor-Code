/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

export function urlsEqual(a: string | undefined, b: string | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (a === undefined || b === undefined) {
		return false;
	}
	try {
		return new URL(a).toString() === new URL(b).toString();
	} catch {
		return false;
	}
}

export interface AllowedMcpServer {
	id: string;
	name: string;
	allowed?: boolean;
	lastUsed?: number;
	trusted?: boolean;
	url?: string;
	agentHost?: { authority: string; label: string };
}

export const IAuthenticationMcpAccessService = createDecorator<IAuthenticationMcpAccessService>('IAuthenticationMcpAccessService');
export interface IAuthenticationMcpAccessService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeMcpSessionAccess: Event<{ providerId: string; accountName: string }>;

	isAccessAllowed(providerId: string, accountName: string, mcpServerId: string): boolean | undefined;
	isAccessAllowedForUrl(providerId: string, accountName: string, mcpServerId: string, mcpServerUrl: string): boolean | undefined;
	readAllowedMcpServers(providerId: string, accountName: string): AllowedMcpServer[];
	updateAllowedMcpServers(providerId: string, accountName: string, mcpServers: AllowedMcpServer[]): void;
	removeAllowedMcpServers(providerId: string, accountName: string): void;
}

export class AuthenticationMcpAccessService extends Disposable implements IAuthenticationMcpAccessService {
	_serviceBrand: undefined;

	private _onDidChangeMcpSessionAccess: Emitter<{ providerId: string; accountName: string }> = this._register(new Emitter<{ providerId: string; accountName: string }>());
	readonly onDidChangeMcpSessionAccess: Event<{ providerId: string; accountName: string }> = this._onDidChangeMcpSessionAccess.event;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IProductService private readonly _productService: IProductService
	) {
		super();
	}

	isAccessAllowed(providerId: string, accountName: string, mcpServerId: string): boolean | undefined {
		return this._isAccessAllowed(providerId, accountName, mcpServerId, undefined);
	}

	isAccessAllowedForUrl(providerId: string, accountName: string, mcpServerId: string, mcpServerUrl: string): boolean | undefined {
		return this._isAccessAllowed(providerId, accountName, mcpServerId, mcpServerUrl);
	}

	private _isAccessAllowed(providerId: string, accountName: string, mcpServerId: string, mcpServerUrl: string | undefined): boolean | undefined {
		const trustedMCPServerAuthAccess = this._productService.trustedMcpAuthAccess;
		if (Array.isArray(trustedMCPServerAuthAccess)) {
			if (trustedMCPServerAuthAccess.includes(mcpServerId)) {
				return true;
			}
		} else if (trustedMCPServerAuthAccess?.[providerId]?.includes(mcpServerId)) {
			return true;
		}

		const allowList = this.readAllowedMcpServers(providerId, accountName);
		const mcpServerData = allowList.find(mcpServer => mcpServer.id === mcpServerId);
		if (!mcpServerData) {
			return undefined;
		}
		if (mcpServerUrl !== undefined && !urlsEqual(mcpServerData.url, mcpServerUrl)) {
			return undefined;
		}
		return mcpServerData.allowed !== undefined
			? mcpServerData.allowed
			: true;
	}

	readAllowedMcpServers(providerId: string, accountName: string): AllowedMcpServer[] {
		let trustedMCPServers: AllowedMcpServer[] = [];
		try {
			const trustedMCPServerSrc = this._storageService.get(`mcpserver-${providerId}-${accountName}`, StorageScope.APPLICATION);
			if (trustedMCPServerSrc) {
				trustedMCPServers = JSON.parse(trustedMCPServerSrc);
			}
		} catch (err) { }

		const trustedMcpServerAuthAccess = this._productService.trustedMcpAuthAccess;
		const trustedMcpServerIds =
			Array.isArray(trustedMcpServerAuthAccess)
				? trustedMcpServerAuthAccess
				: typeof trustedMcpServerAuthAccess === 'object'
					? trustedMcpServerAuthAccess[providerId] ?? []
					: [];

		for (const mcpServerId of trustedMcpServerIds) {
			const existingServer = trustedMCPServers.find(server => server.id === mcpServerId);
			if (!existingServer) {
				trustedMCPServers.push({
					id: mcpServerId,
					name: mcpServerId,
					allowed: true,
					trusted: true
				});
			} else {
				existingServer.allowed = true;
				existingServer.trusted = true;
			}
		}

		return trustedMCPServers;
	}

	updateAllowedMcpServers(providerId: string, accountName: string, mcpServers: AllowedMcpServer[]): void {
		const allowList = this.readAllowedMcpServers(providerId, accountName);
		for (const mcpServer of mcpServers) {
			const index = allowList.findIndex(e => e.id === mcpServer.id);
			if (index === -1) {
				allowList.push(mcpServer);
			} else {
				allowList[index].allowed = mcpServer.allowed;
				if (mcpServer.name && mcpServer.name !== mcpServer.id && allowList[index].name !== mcpServer.name) {
					allowList[index].name = mcpServer.name;
				}
				if (mcpServer.url !== undefined) {
					allowList[index].url = mcpServer.url;
				}
				if (mcpServer.agentHost !== undefined) {
					allowList[index].agentHost = mcpServer.agentHost;
				}
			}
		}

		const userManagedServers = allowList.filter(server => !server.trusted);
		this._storageService.store(`mcpserver-${providerId}-${accountName}`, JSON.stringify(userManagedServers), StorageScope.APPLICATION, StorageTarget.USER);
		this._onDidChangeMcpSessionAccess.fire({ providerId, accountName });
	}

	removeAllowedMcpServers(providerId: string, accountName: string): void {
		this._storageService.remove(`mcpserver-${providerId}-${accountName}`, StorageScope.APPLICATION);
		this._onDidChangeMcpSessionAccess.fire({ providerId, accountName });
	}
}

registerSingleton(IAuthenticationMcpAccessService, AuthenticationMcpAccessService, InstantiationType.Delayed);
