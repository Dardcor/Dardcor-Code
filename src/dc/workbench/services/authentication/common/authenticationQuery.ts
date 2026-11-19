/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { AuthenticationSessionAccount } from './authentication.js';

export interface IAuthenticationUsageStats {
	readonly totalSessions: number;
	readonly totalAccounts: number;
	readonly recentActivity: {
		readonly accountName: string;
		readonly lastUsed: number;
		readonly usageCount: number;
	}[];
}

export interface IActiveEntities {
	readonly extensions: string[];
	readonly mcpServers: string[];
}

export interface IBaseQuery {
	readonly providerId: string;
}

export interface IAccountQuery extends IBaseQuery {
	readonly accountName: string;

	extension(extensionId: string): IAccountExtensionQuery;

	mcpServer(mcpServerId: string): IAccountMcpServerQuery;

	extensions(): IAccountExtensionsQuery;

	mcpServers(): IAccountMcpServersQuery;

	entities(): IAccountEntitiesQuery;

	remove(): void;
}

export interface IAccountExtensionQuery extends IBaseQuery {
	readonly accountName: string;
	readonly extensionId: string;

	isAccessAllowed(): boolean | undefined;

	setAccessAllowed(allowed: boolean, extensionName?: string): void;

	addUsage(scopes: readonly string[], extensionName: string): void;

	getUsage(): {
		readonly extensionId: string;
		readonly extensionName: string;
		readonly scopes: readonly string[];
		readonly lastUsed: number;
	}[];

	removeUsage(): void;

	setAsPreferred(): void;

	isPreferred(): boolean;

	isTrusted(): boolean;
}

export interface IAccountMcpServerQuery extends IBaseQuery {
	readonly accountName: string;
	readonly mcpServerId: string;

	isAccessAllowed(): boolean | undefined;

	setAccessAllowed(allowed: boolean, mcpServerName?: string): void;

	addUsage(scopes: readonly string[], mcpServerName: string): void;

	getUsage(): {
		readonly mcpServerId: string;
		readonly mcpServerName: string;
		readonly scopes: readonly string[];
		readonly lastUsed: number;
	}[];

	removeUsage(): void;

	setAsPreferred(): void;

	isPreferred(): boolean;

	isTrusted(): boolean;
}

export interface IAccountExtensionsQuery extends IBaseQuery {
	readonly accountName: string;

	getAllowedExtensions(): { id: string; name: string; allowed?: boolean; lastUsed?: number; trusted?: boolean }[];

	allowAccess(extensionIds: string[]): void;

	removeAccess(extensionIds: string[]): void;

	forEach(callback: (extensionQuery: IAccountExtensionQuery) => void): void;
}

export interface IAccountMcpServersQuery extends IBaseQuery {
	readonly accountName: string;

	getAllowedMcpServers(): { id: string; name: string; allowed?: boolean; lastUsed?: number; trusted?: boolean; url?: string; agentHost?: { authority: string; label: string } }[];

	allowAccess(mcpServerIds: string[]): void;

	removeAccess(mcpServerIds: string[]): void;

	forEach(callback: (mcpServerQuery: IAccountMcpServerQuery) => void): void;
}

export interface IAccountEntitiesQuery extends IBaseQuery {
	readonly accountName: string;

	hasAnyUsage(): boolean;

	getEntityCount(): { extensions: number; mcpServers: number; total: number };

	removeAllAccess(): void;

	forEach(callback: (entityId: string, entityType: 'extension' | 'mcpServer') => void): void;
}

export interface IProviderExtensionQuery extends IBaseQuery {
	readonly extensionId: string;

	getPreferredAccount(): string | undefined;

	setPreferredAccount(account: AuthenticationSessionAccount): void;

	removeAccountPreference(): void;
}

export interface IProviderMcpServerQuery extends IBaseQuery {
	readonly mcpServerId: string;

	getLastUsedAccount(): Promise<string | undefined>;

	getPreferredAccount(): string | undefined;

	setPreferredAccount(account: AuthenticationSessionAccount): void;

	removeAccountPreference(): void;

	getUsedAccounts(): Promise<string[]>;
}

export interface IProviderQuery extends IBaseQuery {
	account(accountName: string): IAccountQuery;

	extension(extensionId: string): IProviderExtensionQuery;

	mcpServer(mcpServerId: string): IProviderMcpServerQuery;

	getActiveEntities(): Promise<IActiveEntities>;

	getAccountNames(): Promise<string[]>;

	getUsageStats(): Promise<IAuthenticationUsageStats>;

	forEachAccount(callback: (accountQuery: IAccountQuery) => void): Promise<void>;
}

export interface IExtensionQuery {
	readonly extensionId: string;

	getProvidersWithAccess(includeInternal?: boolean): Promise<string[]>;

	getAllAccountPreferences(includeInternal?: boolean): Map<string, string>;

	provider(providerId: string): IProviderExtensionQuery;
}

export interface IMcpServerQuery {
	readonly mcpServerId: string;

	getProvidersWithAccess(includeInternal?: boolean): Promise<string[]>;

	getAllAccountPreferences(includeInternal?: boolean): Map<string, string>;

	provider(providerId: string): IProviderMcpServerQuery;
}

export const IAuthenticationQueryService = createDecorator<IAuthenticationQueryService>('IAuthenticationQueryService');
export interface IAuthenticationQueryService {
	readonly _serviceBrand: undefined;

	readonly onDidChangePreferences: Event<{
		readonly providerId: string;
		readonly entityType: 'extension' | 'mcpServer';
		readonly entityIds: string[];
	}>;

	readonly onDidChangeAccess: Event<{
		readonly providerId: string;
		readonly accountName: string;
	}>;

	provider(providerId: string): IProviderQuery;

	extension(extensionId: string): IExtensionQuery;

	mcpServer(mcpServerId: string): IMcpServerQuery;

	getProviderIds(): string[];

	clearAllData(confirmation: 'CLEAR_ALL_AUTH_DATA', includeInternal?: boolean): Promise<void>;
}
