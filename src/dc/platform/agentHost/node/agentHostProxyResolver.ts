/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogLevel as ProxyLogLevel, ProxyAgentParams, createFetchPatch, createProxyAuthorizationLookup, createProxyResolver, loadSystemCertificates } from '@vscode/proxy-agent';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { equals } from '../../../base/common/objects.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService, LogLevel } from '../../log/common/log.js';
import { AuthInfo, Credentials, systemCertificatesNodeDefault } from '../../request/common/request.js';
import { lookupKerberosAuthorization } from '../../request/node/requestService.js';
import { IAgentHostClientProxyConnection } from '../common/agentHostClientProxyChannel.js';
import { AgentHostProxyConfigKey, agentHostProxyConfigSchema } from '../common/agentHostSchema.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';

export const IAgentHostProxyResolver = createDecorator<IAgentHostProxyResolver>('agentHostProxyResolver');

type AgentHostProxyConfigurationKey = keyof typeof agentHostProxyConfigSchema.definition & string;

export interface IAgentHostProxyResolver {
	readonly _serviceBrand: undefined;

	readonly onDidRegisterConnection: Event<void>;
	readonly onDidChangeConfiguration: Event<void>;

	register(clientId: string, connection: IAgentHostClientProxyConnection): IDisposable;

	getConfigurationValue<T>(key: AgentHostProxyConfigurationKey): T | undefined;

	resolveProxy(url: string): Promise<string | undefined>;

	fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export class AgentHostProxyResolver extends Disposable implements IAgentHostProxyResolver {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidRegisterConnection = this._register(new Emitter<void>());
	readonly onDidRegisterConnection = this._onDidRegisterConnection.event;
	private readonly _onDidChangeConfiguration = this._register(new Emitter<void>());
	readonly onDidChangeConfiguration = this._onDidChangeConfiguration.event;
	private readonly _configurationListener = this._register(new MutableDisposable());

	private readonly _connections = new Map<string, IAgentHostClientProxyConnection>();
	private _configurationValues: Record<string, unknown> = {};
	private _proxyResolver: ReturnType<typeof createProxyResolver> | undefined;
	private _proxyAgentParams: ProxyAgentParams | undefined;
	private _fetch: typeof globalThis.fetch | undefined;

	constructor(
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._configurationValues = this._readConfigurationValues();
		this._configurationListener.value = this._configurationService.onDidRootConfigChange(() => {
			const values = this._readConfigurationValues();
			if (!equals(this._configurationValues, values)) {
				this._configurationValues = values;
				this._onDidChangeConfiguration.fire();
			}
		});
	}

	getConfigurationValue<T>(key: AgentHostProxyConfigurationKey): T | undefined {
		return this._configurationService.getRootValue(agentHostProxyConfigSchema, key) as T | undefined;
	}

	private _readConfigurationValues(): Record<string, unknown> {
		return Object.fromEntries(Object.values(AgentHostProxyConfigKey).map(key => [key, this.getConfigurationValue(key)]));
	}

	register(clientId: string, connection: IAgentHostClientProxyConnection): IDisposable {
		const hadConnections = this._connections.size > 0;
		this._connections.set(clientId, connection);
		if (!hadConnections) {
			this._onDidRegisterConnection.fire();
		}
		return toDisposable(() => {
			if (this._connections.get(clientId) === connection) {
				this._connections.delete(clientId);
			}
		});
	}

	resolveProxy(url: string): Promise<string | undefined> {
		return this._getProxyResolver().resolveProxyURL(url);
	}

	fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
		if (!this._fetch) {
			const proxyResolver = this._getProxyResolver();
			this._fetch = createFetchPatch(this._proxyAgentParams!, globalThis.fetch, proxyResolver.resolveProxyURL);
		}
		return this._fetch(input, init);
	}

	private _getProxyResolver(): ReturnType<typeof createProxyResolver> {
		if (!this._proxyResolver) {
			const params: ProxyAgentParams = {
				resolveProxy: (url) => this._hostResolveProxy(url),
				lookupProxyAuthorization: createProxyAuthorizationLookup({
					log: this._logService,
					lookupAuthorization: authInfo => this._hostLookupAuthorization(authInfo),
					lookupKerberosAuthorization: url => this._hostLookupKerberosAuthorization(url),
				}),
				getProxyURL: () => this.getConfigurationValue<string>(AgentHostProxyConfigKey.Proxy),
				getProxySupport: () => 'override',
				getNoProxyConfig: () => this.getConfigurationValue<string[]>(AgentHostProxyConfigKey.NoProxy) || [],
				isAdditionalFetchSupportEnabled: () => true,
				isWebSocketPatchEnabled: () => true,
				addCertificatesV1: () => true,
				addCertificatesV2: () => false,
				loadSystemCertificatesFromNode: () => systemCertificatesNodeDefault,
				loadAdditionalCertificates: async () => loadSystemCertificates({
					loadSystemCertificatesFromNode: () => systemCertificatesNodeDefault,
					log: this._logService,
				}),
				log: this._logService,
				getLogLevel: () => {
					switch (this._logService.getLevel()) {
						case LogLevel.Trace: return ProxyLogLevel.Trace;
						case LogLevel.Debug: return ProxyLogLevel.Debug;
						case LogLevel.Info: return ProxyLogLevel.Info;
						case LogLevel.Warning: return ProxyLogLevel.Warning;
						case LogLevel.Error: return ProxyLogLevel.Error;
						case LogLevel.Off: return ProxyLogLevel.Off;
						default: return ProxyLogLevel.Info;
					}
				},
				proxyResolveTelemetry: () => { },
				isUseHostProxyEnabled: () => this._connections.size > 0,
				getNetworkInterfaceCheckInterval: () => 300 * 1000,
				env: process.env,
			};
			this._proxyAgentParams = params;
			this._proxyResolver = createProxyResolver(params);
		}
		return this._proxyResolver;
	}

	private async _hostResolveProxy(url: string): Promise<string | undefined> {
		for (const connection of this._connections.values()) {
			try {
				return await connection.resolveProxy(url);
			} catch {
			}
		}
		return undefined;
	}

	private async _hostLookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined> {
		for (const connection of this._connections.values()) {
			try {
				return await connection.lookupAuthorization(authInfo);
			} catch {
			}
		}
		return undefined;
	}

	private async _hostLookupKerberosAuthorization(url: string): Promise<string | undefined> {
		for (const connection of this._connections.values()) {
			try {
				return await connection.lookupKerberosAuthorization(url);
			} catch {
			}
		}
		try {
			const spn = this.getConfigurationValue<string>(AgentHostProxyConfigKey.ProxyKerberosServicePrincipal);
			return `Negotiate ${await this._lookupKerberosAuthorization(url, spn)}`;
		} catch (error) {
			this._logService.debug('AgentHostProxyResolver#lookupKerberosAuthorization Kerberos authentication failed', error);
			return undefined;
		}
	}

	protected _lookupKerberosAuthorization(url: string, spn: string | undefined): Promise<string> {
		return lookupKerberosAuthorization(url, spn, this._logService, 'AgentHostProxyResolver#lookupKerberosAuthorization');
	}
}
