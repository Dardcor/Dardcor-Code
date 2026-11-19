/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CustomFetcher } from '@vscode/extension-telemetry';
import * as vscode from 'vscode';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { IInstantiationService } from '../../../util/dardcor/platform/instantiation/common/instantiation';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import { ConfigKey, IConfigurationService } from '../../configuration/common/configurationService';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IDomainService } from '../../endpoint/common/domainService';
import { IEnvService } from '../../env/common/envService';
import { IFetcherService, NO_FETCH_TELEMETRY } from '../../networking/common/fetcherService';
import { FetcherService } from '../../networking/dardcor-node/fetcherServiceImpl';
import { BaseTelemetryService } from '../common/baseTelemetryService';
import { IExperimentationService } from '../common/nullExperimentationService';
import { ITelemetryUserConfig, setTelemetryPropertyCompressor, TelemetryTrustedValue } from '../common/telemetry';
import { GitHubTelemetrySender } from './githubTelemetrySender';
import { MicrosoftTelemetrySender } from './microsoftTelemetrySender';

const gzip = promisify(zlib.gzip);
setTelemetryPropertyCompressor(async value => (await gzip(Buffer.from(value, 'utf8'))).toString('base64'));

const CAPI_ASSIGNMENT_CONTEXT_PROPERTY = 'capi.assignmentcontext';

const SET_CAPI_ASSIGNMENT_CONTEXT_COMMAND = '_telemetry.setCapiAssignmentContext';

export class TelemetryService extends BaseTelemetryService {
	declare readonly _serviceBrand: undefined;
	constructor(
		extensionName: string,
		internalMSFTAIKey: string,
		externalMSFTAIKey: string,
		externalGHAIKey: string,
		estrictedGHAIKey: string,
		@IConfigurationService configService: IConfigurationService,
		@ICopilotTokenStore tokenStore: ICopilotTokenStore,
		@ICAPIClientService capiClientService: ICAPIClientService,
		@IEnvService envService: IEnvService,
		@ITelemetryUserConfig telemetryUserConfig: ITelemetryUserConfig,
		@IDomainService domainService: IDomainService,
		@IFetcherService fetcherService: IFetcherService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		const customFetcher: CustomFetcher = async (url: string, init?: { method: 'POST'; headers?: Record<string, string>; body?: string }) => {
			return fetcherService.fetch(url, {
				method: init?.method,
				headers: init?.headers,
				body: init?.body,
				callSite: NO_FETCH_TELEMETRY,
			});
		};
		const microsoftTelemetrySender = new MicrosoftTelemetrySender(
			internalMSFTAIKey,
			externalMSFTAIKey,
			tokenStore,
			customFetcher
		);

		let cachedUseNewTelemetryLib: boolean | undefined;
		const computeUseNewTelemetryLib = () => {
			const expService = instantiationService.invokeFunction(accessor => accessor.get(IExperimentationService));
			return configService.getExperimentBasedConfig(ConfigKey.TeamInternal.UseVSCodeTelemetryLibForGH, expService);
		};
		const useNewTelemetryLibGetter = () => {
			if (cachedUseNewTelemetryLib === undefined) {
				cachedUseNewTelemetryLib = computeUseNewTelemetryLib();
			}
			return cachedUseNewTelemetryLib;
		};

		const ghTelemetrySender = new GitHubTelemetrySender(
			configService,
			envService,
			telemetryUserConfig,
			domainService,
			capiClientService,
			extensionName,
			externalGHAIKey,
			estrictedGHAIKey,
			tokenStore,
			useNewTelemetryLibGetter,
			customFetcher
		);
		super(tokenStore, capiClientService, microsoftTelemetrySender, ghTelemetrySender);

		if (fetcherService instanceof FetcherService) {
			fetcherService.setTelemetryService(this);
		}

		this._disposables.push(configService.onDidChangeConfiguration(e => {
			if (cachedUseNewTelemetryLib !== undefined && e.affectsConfiguration(ConfigKey.TeamInternal.UseVSCodeTelemetryLibForGH.fullyQualifiedId)) {
				cachedUseNewTelemetryLib = computeUseNewTelemetryLib();
			}
		}));

		if (envService.isPreRelease()) {
			fetcherService.onDidCompleteFetch(event => {
				if (event.callSite === NO_FETCH_TELEMETRY) {
					return;
				}
				this.sendMSFTTelemetryEvent('fetchTelemetry', {
					callSite: new TelemetryTrustedValue(event.callSite),
					cacheStatus: event.cacheStatus ?? '',
				}, {
					latencyMs: event.latencyMs,
					statusCode: event.statusCode,
				});
			});
		}
	}

	override setSharedProperty(name: string, value: string): void {
		super.setSharedProperty(name, value);

		if (name === CAPI_ASSIGNMENT_CONTEXT_PROPERTY) {
			vscode.commands.executeCommand(SET_CAPI_ASSIGNMENT_CONTEXT_COMMAND, value);
		}
	}
}
