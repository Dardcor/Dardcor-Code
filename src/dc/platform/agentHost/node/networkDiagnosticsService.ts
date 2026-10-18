/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { lookup } from 'dns';
import { streamToBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService, NO_FETCH_TELEMETRY } from '../../request/common/request.js';
import { IAgentHostNetworkEndpoint } from '../common/agent.js';
import { IAgentHostDnsResult, IAgentHostNetworkDiagnosticsInfo, IAgentHostNetworkFetchResult } from '../common/agentService.js';
import { AgentHostProxyConfigKey, agentHostProxyConfigSchema } from '../common/agentHostSchema.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';
import { IAgentHostProxyResolver } from './agentHostProxyResolver.js';

export const INetworkDiagnosticsService = createDecorator<INetworkDiagnosticsService>('networkDiagnosticsService');

export interface INetworkDiagnosticsService {
	readonly _serviceBrand: undefined;

	getInfo(endpoints: readonly IAgentHostNetworkEndpoint[], account?: string): Promise<IAgentHostNetworkDiagnosticsInfo>;

	fetch(url: string): Promise<IAgentHostNetworkFetchResult>;
}

const PROBE_TIMEOUT_MS = 10_000;

const MAX_BODY_CHARS = 64 * 1024;

const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'COPILOT_PROXY_KERBEROS_SPN'] as const;

const PROXY_CONFIG_KEYS = [AgentHostProxyConfigKey.Proxy, AgentHostProxyConfigKey.NoProxy, AgentHostProxyConfigKey.ProxyKerberosServicePrincipal] as const;

export class NetworkDiagnosticsService implements INetworkDiagnosticsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IRequestService private readonly _requestService: IRequestService,
		@IAgentHostProxyResolver private readonly _proxyResolver: IAgentHostProxyResolver,
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
		@IProductService private readonly _productService: IProductService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async getInfo(endpoints: readonly IAgentHostNetworkEndpoint[], account?: string): Promise<IAgentHostNetworkDiagnosticsInfo> {
		const proxyEnv: Record<string, string> = {};
		for (const key of PROXY_ENV_KEYS) {
			const value = process.env[key];
			if (value) {
				proxyEnv[key] = value;
			}
		}

		const proxySettings: Record<string, string> = {};
		for (const key of PROXY_CONFIG_KEYS) {
			const value = this._configurationService.getRootValue(agentHostProxyConfigSchema, key);
			if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
				continue;
			}
			proxySettings[key] = Array.isArray(value) ? value.join(', ') : String(value);
		}

		return {
			version: this._productService.version,
			os: process.platform,
			arch: process.arch,
			account,
			proxySettings,
			proxyEnv,
			endpoints,
		};
	}

	async fetch(url: string): Promise<IAgentHostNetworkFetchResult> {
		const target = new URL(url);
		const host = target.hostname;

		const [dnsIpv4, dnsIpv6] = await Promise.all([
			resolveDns(host, 4),
			resolveDns(host, 6),
		]);

		let proxyUrl: string | undefined;
		try {
			proxyUrl = await this._proxyResolver.resolveProxy(url);
		} catch (err) {
			this._logService.debug(`[AgentHost] Network diagnostics: proxy resolution for ${url} failed: ${errorMessage(err)}`);
		}

		const base = {
			url,
			proxyUrl,
			dnsIpv4, dnsIpv6,
		};

		const probeStart = Date.now();
		try {
			const context = await this._requestService.request({
				url,
				type: 'GET',
				timeout: PROBE_TIMEOUT_MS,
				callSite: NO_FETCH_TELEMETRY,
			}, CancellationToken.None);
			const body = (await streamToBuffer(context.stream)).toString();
			return {
				...base,
				statusCode: context.res.statusCode,
				body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
				durationMs: Date.now() - probeStart,
			};
		} catch (err) {
			return {
				...base,
				error: errorMessage(err),
				durationMs: Date.now() - probeStart,
			};
		}
	}
}

function dnsLookup(host: string, family: 4 | 6): Promise<string> {
	return new Promise((resolve, reject) => {
		lookup(host, { family }, (err, address) => err ? reject(err) : resolve(address));
	});
}

async function resolveDns(host: string, family: 4 | 6): Promise<IAgentHostDnsResult> {
	const start = Date.now();
	try {
		const address = await withTimeout(dnsLookup(host, family), PROBE_TIMEOUT_MS);
		return { address, durationMs: Date.now() - start };
	} catch (err) {
		return { durationMs: Date.now() - start, error: errorMessage(err) };
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms);
		promise.then(
			value => { clearTimeout(timer); resolve(value); },
			err => { clearTimeout(timer); reject(err); },
		);
	});
}

function errorMessage(error: unknown): string {
	const seen = new Set<unknown>();
	function collect(error: unknown): string {
		if (seen.has(error)) {
			return '';
		}
		seen.add(error);
		if (!(error instanceof Error)) {
			return String(error);
		}
		const details = [
			error.cause ? collect(error.cause) : '',
			...(error instanceof AggregateError ? error.errors.map(collect) : []),
		].filter(Boolean).join(', ');
		return details ? `${error.message}: ${details}` : error.message;
	}
	return collect(error);
}
