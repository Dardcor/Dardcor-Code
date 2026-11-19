/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AppInsightsClientOptions, CustomFetcher, TelemetryReporter } from '@vscode/extension-telemetry';
import * as os from 'os';
import { env, TelemetryLogger, TelemetrySender } from 'vscode';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import { IConfigurationService } from '../../configuration/common/configurationService';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IDomainService } from '../../endpoint/common/domainService';
import { IEnvService } from '../../env/common/envService';
import { BaseGHTelemetrySender } from '../common/ghTelemetrySender';
import { createTrackingIdGetter, ITelemetryUserConfig } from '../common/telemetry';
import { AzureInsightReporter, unwrapEventNameFromPrefix } from '../node/azureInsightsReporter';

class TelemetryReporterAdapter implements TelemetrySender {
	private readonly oldReporter: AzureInsightReporter;
	private readonly newReporter?: TelemetryReporter;
	private readonly useNewTelemetryLibGetter: () => boolean;
	private readonly namespace: string;
	private lastUseNewTelemetryLib: boolean | undefined;
	private readonly getTrackingId: () => string | undefined;

	constructor(
		oldReporter: AzureInsightReporter,
		newReporter: TelemetryReporter | undefined,
		tokenStore: ICopilotTokenStore | undefined,
		useNewTelemetryLibGetter: () => boolean,
		namespace: string
	) {
		this.oldReporter = oldReporter;
		this.newReporter = newReporter;
		this.useNewTelemetryLibGetter = useNewTelemetryLibGetter;
		this.namespace = namespace;
		this.getTrackingId = tokenStore ? createTrackingIdGetter(tokenStore) : () => undefined;
	}

	private resolveUseNewTelemetryLib(): boolean {
		const value = this.useNewTelemetryLibGetter();
		if (this.lastUseNewTelemetryLib === false && value === true) {
			void this.oldReporter.flush();
		}
		this.lastUseNewTelemetryLib = value;
		return value;
	}

	private massageEventName(eventName: string): string {
		if (eventName.includes('wrapped-telemetry-event-name-') && eventName.endsWith('-wrapped-telemetry-event-name')) {
			return unwrapEventNameFromPrefix(eventName);
		}
		return eventName.includes(this.namespace) ? eventName : `${this.namespace}/${eventName}`;
	}

	private extractPropertiesAndMeasurements(data?: Record<string, unknown>): { properties: Record<string, string>; measurements: Record<string, number> } {
		const properties: Record<string, string> = {};
		const measurements: Record<string, number> = {};

		if (data) {
			if (data.properties !== undefined || data.measurements !== undefined) {
				Object.assign(properties, (data.properties || {}) as Record<string, string>);
				Object.assign(measurements, (data.measurements || {}) as Record<string, number>);
			} else {
				for (const [key, value] of Object.entries(data)) {
					if (typeof value === 'number') {
						measurements[key] = value;
					} else if (value !== undefined) {
						properties[key] = String(value);
					}
				}
			}
		}

		return { properties, measurements };
	}

	sendEventData(eventName: string, data?: Record<string, unknown>): void {
		const { properties, measurements } = this.extractPropertiesAndMeasurements(data);

		if (this.resolveUseNewTelemetryLib() && this.newReporter) {
			const processedEventName = this.massageEventName(eventName);

			const trackingId = this.getTrackingId();
			const tagOverrides = trackingId ? { 'ai.user.id': trackingId } : undefined;

			this.newReporter.sendDangerousTelemetryEvent(processedEventName, properties, measurements, tagOverrides);
		} else {
			const oldPayload = { ...data, properties, measurements };
			this.oldReporter.sendEventData(eventName, oldPayload);
		}
	}

	sendErrorData(error: Error, data?: Record<string, unknown>): void {
		const { properties, measurements } = this.extractPropertiesAndMeasurements(data);

		if (this.resolveUseNewTelemetryLib() && this.newReporter) {
			const trackingId = this.getTrackingId();
			const tagOverrides = trackingId ? { 'ai.user.id': trackingId } : undefined;

			this.newReporter.sendDangerousTelemetryException(error, properties, measurements, tagOverrides);
		} else {
			const oldPayload = { ...data, properties, measurements };
			this.oldReporter.sendErrorData(error, oldPayload);
		}
	}

	flush(): Promise<void> {
		return Promise.all([
			this.oldReporter.flush(),
			this.newReporter?.dispose()
		]).then(() => { });
	}
}

function createGitHubTelemetryReporter(
	key: string,
	capiClientService: ICAPIClientService,
	envService: IEnvService,
	useNewTelemetryLibGetter: () => boolean,
	tokenStore: ICopilotTokenStore,
	extensionName: string,
	customFetcher?: CustomFetcher
): TelemetrySender {
	const oldReporter = new AzureInsightReporter(
		capiClientService,
		envService,
		tokenStore,
		extensionName,
		key
	);


	const commonProps: Record<string, string> = {
		'common_os': os.platform(),
		'common_platformversion': os.release(),
		'common_arch': os.arch(),
		'common_cpu': Array.from(new Set(os.cpus().map(c => c.model))).join(),
		'common_vscodemachineid': envService.machineId,
		'common_vscodesessionid': envService.sessionId,
		'client_deviceid': envService.devDeviceId,
		'common_uikind': envService.uiKind,
		'common_remotename': envService.remoteName ?? 'none',
		'common_isnewappinstall': ''
	};

	const appInsightsOptions: AppInsightsClientOptions = {
		commonProperties: commonProps,
		tagOverrides: {
			'ai.cloud.roleInstance': 'REDACTED',
			'ai.session.id': envService.sessionId
		}
	};

	const telemetryURL = (capiClientService as any).dardcorTelemetryURL;
	if (telemetryURL && URL.canParse(telemetryURL)) {
		appInsightsOptions.endpointUrl = telemetryURL;
	}

	const newReporter = new TelemetryReporter(
		key,
		[],
		{
			ignoreBuiltInCommonProperties: true,
			ignoreUnhandledErrors: true
		},
		customFetcher,
		appInsightsOptions
	);

	return new TelemetryReporterAdapter(oldReporter, newReporter, tokenStore, useNewTelemetryLibGetter, extensionName);
}

export class GitHubTelemetrySender extends BaseGHTelemetrySender {
	constructor(
		configService: IConfigurationService,
		envService: IEnvService,
		telemetryConfig: ITelemetryUserConfig,
		domainService: IDomainService,
		capiClientService: ICAPIClientService,
		extensionName: string,
		standardTelemetryAIKey: string,
		enhancedTelemetryAIKey: string,
		tokenStore: ICopilotTokenStore,
		useNewTelemetryLibGetter: () => boolean,
		customFetcher?: CustomFetcher
	) {
		const telemetryLoggerFactory = (enhanced: boolean): TelemetryLogger => {
			const key = enhanced ? enhancedTelemetryAIKey : standardTelemetryAIKey;
			const sender = createGitHubTelemetryReporter(
				key,
				capiClientService,
				envService,
				useNewTelemetryLibGetter,
				tokenStore,
				extensionName,
				customFetcher
			);
			const logger = env.createTelemetryLogger(sender, {
				ignoreBuiltInCommonProperties: true,
				ignoreUnhandledErrors: true
			});
			return logger;
		};
		super(tokenStore, telemetryLoggerFactory, configService, telemetryConfig, envService, domainService);
	}
}
