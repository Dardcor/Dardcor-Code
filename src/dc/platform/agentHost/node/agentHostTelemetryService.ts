/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hostname, release } from 'os';
import { Disposable, isDisposable, toDisposable, type DisposableStore } from '../../../base/common/lifecycle.js';
import { getDevDeviceId, getMachineId, getSqmMachineId } from '../../../base/node/id.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService, ILoggerService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IRequestService } from '../../request/common/request.js';
import { OneDataSystemAppender } from '../../telemetry/node/1dsAppender.js';
import { resolveCommonProperties, verifyMicrosoftInternalDomain } from '../../telemetry/common/commonProperties.js';
import { ClassifiedEvent, IGDPRProperty, OmitMetadata, StrictPropertyCheck } from '../../telemetry/common/gdprTypings.js';
import { ITelemetryData, ITelemetryService, TelemetryLevel } from '../../telemetry/common/telemetry.js';
import { TelemetryLogAppender } from '../../telemetry/common/telemetryLogAppender.js';
import { TelemetryService } from '../../telemetry/common/telemetryService.js';
import { getPiiPathsFromEnvironment, isLoggingOnly, NullTelemetryService, supportsTelemetry, type ITelemetryAppender } from '../../telemetry/common/telemetryUtils.js';
import { AgentHostTelemetryLevelConfigKey, agentHostConfigValueToTelemetryLevel } from '../common/agentHostSchema.js';
import { AgentHostDevDeviceIdEnvKey, AgentHostMachineIdEnvKey, AgentHostSqmIdEnvKey, AgentHostTelemetryLevelEnvKey } from '../common/agentHostTelemetryEnv.js';
import { AgentHostRestrictedTelemetrySender, IAgentHostRestrictedTelemetry, IAgentHostInternalTelemetryContext, IAgentHostRestrictedTelemetryContext, TelemetryMeasurements, TelemetryProps } from './agentHostRestrictedTelemetry.js';
import { AgentHostInternalTelemetrySender } from './agentHostMicrosoftTelemetry.js';

export interface IAgentHostTelemetryServiceOptions {
	readonly environmentService: INativeEnvironmentService;
	readonly productService: IProductService;
	readonly fileService: IFileService;
	readonly loggerService: ILoggerService | undefined;
	readonly logService: ILogService;
	readonly disposables: DisposableStore;
	readonly disableTelemetry?: boolean;
	readonly fetchFn?: typeof globalThis.fetch;
	readonly requestService?: IRequestService;
	readonly readTelemetryLevelEnvironment?: () => string | undefined;
}

export interface IAgentHostTelemetryService extends ITelemetryService, IAgentHostRestrictedTelemetry {
	updateTelemetryLevel(telemetryLevel: TelemetryLevel): void;
}

export class AgentHostTelemetryService extends Disposable implements IAgentHostTelemetryService {
	declare readonly _serviceBrand: undefined;

	private _telemetryLevel: TelemetryLevel;

	private _restrictedTelemetryEnabled = false;
	private _internalTelemetryEnabled = false;

	private readonly _internalMachine: boolean;

	constructor(
		private readonly _delegate: ITelemetryService,
		private readonly _restricted?: IAgentHostRestrictedTelemetry,
		initialTelemetryLevel: TelemetryLevel = TelemetryLevel.USAGE,
	) {
		super();
		this._telemetryLevel = initialTelemetryLevel;
		this._internalMachine = _delegate.msftInternal === true;
		if (isDisposable(_delegate)) {
			this._register(_delegate);
		}
	}

	get telemetryLevel(): TelemetryLevel {
		return Math.min(this._delegate.telemetryLevel, this._telemetryLevel);
	}

	get sendErrorTelemetry(): boolean {
		return this.telemetryLevel >= TelemetryLevel.ERROR && this._delegate.sendErrorTelemetry;
	}

	get sessionId(): string {
		return this._delegate.sessionId;
	}

	get machineId(): string {
		return this._delegate.machineId;
	}

	get sqmId(): string {
		return this._delegate.sqmId;
	}

	get devDeviceId(): string {
		return this._delegate.devDeviceId;
	}

	get firstSessionDate(): string {
		return this._delegate.firstSessionDate;
	}

	get msftInternal(): boolean | undefined {
		return this._delegate.msftInternal;
	}

	publicLog(eventName: string, data?: ITelemetryData): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE) {
			return;
		}
		this._delegate.publicLog(eventName, data);
	}

	publicLogError(eventName: string, data?: ITelemetryData): void {
		if (this.telemetryLevel < TelemetryLevel.ERROR) {
			return;
		}
		this._delegate.publicLogError(eventName, data);
	}

	publicLog2<E extends ClassifiedEvent<OmitMetadata<T>> = never, T extends IGDPRProperty = never>(eventName: string, data?: StrictPropertyCheck<T, E>): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE) {
			return;
		}
		this._delegate.publicLog2(eventName, data);
	}

	publicLogError2<E extends ClassifiedEvent<OmitMetadata<T>> = never, T extends IGDPRProperty = never>(eventName: string, data?: StrictPropertyCheck<T, E>): void {
		if (this.telemetryLevel < TelemetryLevel.ERROR) {
			return;
		}
		this._delegate.publicLogError2(eventName, data);
	}

	sendGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE) {
			return;
		}
		this._restricted?.sendGHTelemetryEvent(eventName, properties, measurements);
	}

	sendEnhancedGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE || !this._restrictedTelemetryEnabled) {
			return;
		}
		this._restricted?.sendEnhancedGHTelemetryEvent(eventName, properties, measurements);
	}

	sendEnhancedGHTelemetryEventForContext(context: IAgentHostRestrictedTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE || !context.restrictedTelemetryEnabled) {
			return;
		}
		this._restricted?.sendEnhancedGHTelemetryEventForContext(context, eventName, properties, measurements);
	}

	sendInternalMSFTTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE || !this._internalTelemetryEnabled) {
			return;
		}
		this._restricted?.sendInternalMSFTTelemetryEvent(eventName, properties, measurements);
	}

	sendInternalMSFTTelemetryEventForContext(context: IAgentHostInternalTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (this.telemetryLevel < TelemetryLevel.USAGE || !context.isInternal) {
			return;
		}
		this._restricted?.sendInternalMSFTTelemetryEventForContext(context, eventName, properties, measurements);
	}

	setCopilotTrackingId(trackingId: string | undefined): void {
		this._restricted?.setCopilotTrackingId(trackingId);
	}

	setRestrictedTelemetryEndpoint(endpointUrl: string | undefined): void {
		this._restricted?.setRestrictedTelemetryEndpoint(endpointUrl);
	}

	setRestrictedTelemetryEnabled(enabled: boolean): void {
		this._restrictedTelemetryEnabled = enabled;
		this._restricted?.setRestrictedTelemetryEnabled(enabled);
	}

	setInternalTelemetryContext(context: IAgentHostInternalTelemetryContext | undefined): void {
		this._internalTelemetryEnabled = context?.isInternal === true;
		if (context) {
			this._delegate.setCommonProperty('common.msftInternal', this._internalMachine || this._internalTelemetryEnabled);
		}
		this._restricted?.setInternalTelemetryContext(context);
	}

	setExperimentProperty(name: string, value: string): void {
		this._delegate.setExperimentProperty(name, value);
	}

	setCommonProperty(name: string, value: string | boolean | undefined): void {
		this._delegate.setCommonProperty(name, value);
		this._restricted?.setCommonProperty(name, value);
	}

	updateTelemetryLevel(telemetryLevel: TelemetryLevel): void {
		this._telemetryLevel = Math.min(this._telemetryLevel, telemetryLevel);
	}
}

export function updateAgentHostTelemetryLevelFromConfig(telemetryService: ITelemetryService, config: Record<string, unknown> | undefined): void {
	const telemetryLevel = config?.[AgentHostTelemetryLevelConfigKey];
	const telemetryLevelValue = agentHostConfigValueToTelemetryLevel(telemetryLevel);
	if (!isAgentHostTelemetryService(telemetryService) || telemetryLevelValue === undefined) {
		return;
	}
	telemetryService.updateTelemetryLevel(telemetryLevelValue);
}

export function isAgentHostTelemetryService(telemetryService: ITelemetryService): telemetryService is IAgentHostTelemetryService {
	return typeof (telemetryService as IAgentHostTelemetryService).updateTelemetryLevel === 'function';
}

export async function createAgentHostTelemetryService(options: IAgentHostTelemetryServiceOptions): Promise<IAgentHostTelemetryService> {
	const { environmentService, productService, loggerService, logService, disposables } = options;
	if (options.disableTelemetry || !loggerService || !supportsTelemetry(productService, environmentService)) {
		return disposables.add(new AgentHostTelemetryService(NullTelemetryService));
	}

	const initialTelemetryLevel = Math.min(
		parseLaunchTelemetryLevel((environmentService.args as any)?.['telemetry-level']),
		parseLaunchTelemetryLevel((options.readTelemetryLevelEnvironment ?? (() => process.env[AgentHostTelemetryLevelEnvKey]))()),
	);
	const internalTelemetry = verifyMicrosoftInternalDomain(productService.msftInternalDomains ?? []);

	const appenders: ITelemetryAppender[] = [
		disposables.add(new TelemetryLogAppender('', false, loggerService, environmentService, productService)),
	];
	const loggingOnly = isLoggingOnly(productService, environmentService);
	if (!loggingOnly && productService.aiConfig?.ariaKey) {
		const collectorAppender = new OneDataSystemAppender(options.requestService, internalTelemetry, 'monacoworkbench', null, productService.aiConfig.ariaKey);
		disposables.add(toDisposable(() => { void collectorAppender.flush(); }));
		appenders.push(collectorAppender);
	}

	const [machineId, sqmId, devDeviceId] = await Promise.all([
		process.env[AgentHostMachineIdEnvKey] || getMachineId(error => logService.error(error)),
		process.env[AgentHostSqmIdEnvKey] || getSqmMachineId(error => logService.error(error)),
		process.env[AgentHostDevDeviceIdEnvKey] || getDevDeviceId(error => logService.error(error)),
	]);

	const commonProperties = resolveCommonProperties(release(), hostname(), process.arch, productService.commit, productService.version, machineId, sqmId, devDeviceId, internalTelemetry, productService.date);

	const telemetryService = (TelemetryService as any).createWithLevel?.({
		appenders,
		sendErrorTelemetry: true,
		commonProperties,
		piiPaths: getPiiPathsFromEnvironment(environmentService),
		telemetryLevel: initialTelemetryLevel,
	}, productService) ?? new TelemetryService({
		appenders,
		sendErrorTelemetry: true,
		commonProperties,
		piiPaths: getPiiPathsFromEnvironment(environmentService),
	}, {
		getValue: () => undefined,
		onDidChangeConfiguration: () => ({ dispose: () => { } })
	} as any, productService);

	const internalSender = loggingOnly ? undefined : disposables.add(new AgentHostInternalTelemetrySender({ requestService: options.requestService, commonProperties }));
	const restricted = loggingOnly ? undefined : new AgentHostRestrictedTelemetrySender(commonProperties, logService, undefined, internalSender, options.fetchFn);

	return disposables.add(new AgentHostTelemetryService(telemetryService, restricted, initialTelemetryLevel));
}

function parseLaunchTelemetryLevel(value: string | undefined): TelemetryLevel {
	return value === undefined
		? TelemetryLevel.USAGE
		: agentHostConfigValueToTelemetryLevel(value) ?? TelemetryLevel.NONE;
}
