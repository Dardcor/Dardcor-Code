/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { LRUCache } from '../../../base/common/map.js';
import { matchesScheme, Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { extractDomainFromUri, isDomainAllowed } from './domainMatcher.js';
import { AgentNetworkDomainSettingId } from './settings.js';

export const IAgentNetworkFilterService = createDecorator<IAgentNetworkFilterService>('agentNetworkFilterService');

function isFilteredNetworkScheme(uri: URI): boolean {
	return matchesScheme(uri, Schemas.http)
		|| matchesScheme(uri, Schemas.https)
		|| matchesScheme(uri, 'ws')
		|| matchesScheme(uri, 'wss');
}

export interface IAgentNetworkFilterService {
	readonly _serviceBrand: undefined;

	isUriAllowed(uri: URI): boolean;

	isEnabled(): boolean;

	formatError(uri: URI): string;

	readonly onDidChange: Event<void>;
}

export class AgentNetworkFilterService extends Disposable implements IAgentNetworkFilterService {
	readonly _serviceBrand: undefined;

	private networkFilterEnabled = false;
	private allowedPatterns: string[] = [];
	private deniedPatterns: string[] = [];
	private readonly domainCache = new LRUCache<string, boolean>(100);

	private readonly onDidChangeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.readConfiguration();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(AgentNetworkDomainSettingId.NetworkFilter) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains) ||
				e.affectsConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains)
			) {
				this.readConfiguration();
				this.onDidChangeEmitter.fire();
			}
		}));
	}

	private readConfiguration(): void {
		const networkFilterEnabled = this.configurationService.getValue<boolean>(AgentNetworkDomainSettingId.NetworkFilter) ?? false;

		this.networkFilterEnabled = networkFilterEnabled;
		this.allowedPatterns = this.configurationService.getValue<string[]>(AgentNetworkDomainSettingId.AllowedNetworkDomains) ?? [];
		this.deniedPatterns = this.configurationService.getValue<string[]>(AgentNetworkDomainSettingId.DeniedNetworkDomains) ?? [];
		this.domainCache.clear();
	}

	isUriAllowed(uri: URI): boolean {
		if (!this.isEnabled()) {
			return true;
		}

		if (matchesScheme(uri, Schemas.file)
			|| (!uri.authority && !isFilteredNetworkScheme(uri))) {
			return true;
		}

		const domain = extractDomainFromUri(uri);
		if (!domain) {
			return !isFilteredNetworkScheme(uri);
		}

		let result = this.domainCache.get(domain);
		if (result === undefined) {
			result = isDomainAllowed(domain, this.allowedPatterns, this.deniedPatterns);
			this.domainCache.set(domain, result);
		}

		return result;
	}

	isEnabled(): boolean {
		return this.networkFilterEnabled;
	}

	formatError(uri: URI): string {
		const domain = extractDomainFromUri(uri);
		return localize(
			'networkFilter.blockedByPolicy',
			'Access to {0} is blocked by network domain policy (see `{1}` and `{2}` settings).',
			domain ?? uri.authority,
			AgentNetworkDomainSettingId.AllowedNetworkDomains,
			AgentNetworkDomainSettingId.DeniedNetworkDomains,
		);
	}
}
