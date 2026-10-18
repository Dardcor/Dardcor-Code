/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { TelemetrySender } from 'vscode';
import { createServiceIdentifier } from '../../../util/common/services';
import { IDisposable } from '../../../util/dardcor/base/common/lifecycle';
import type { CopilotToken } from '../../authentication/common/dardcorToken';
import { ICopilotTokenStore } from '../../authentication/common/dardcorTokenStore';
import type { TelemetryData } from './telemetryData';


export interface TelemetryEventMeasurements {
	readonly [key: string]: number | undefined;
}

export interface TelemetryEventProperties {
	readonly [key: string]: string | import('vscode').TelemetryTrustedValue<string> | undefined;
}

export interface IExperimentationTelemetry {
	setSharedProperty(name: string, value: string): void;
	postEvent(eventName: string, props: Map<string, string>): void;
}

export const ITelemetryUserConfig = createServiceIdentifier<ITelemetryUserConfig>('ITelemetryUserConfig');

export interface ITelemetryUserConfig {
	readonly _serviceBrand: undefined;
	trackingId: string | undefined;
	organizationsList: string | undefined;
	enterpriseList: string | undefined;
	optedIn: boolean;
}

export class TelemetryUserConfigImpl implements ITelemetryUserConfig {
	declare readonly _serviceBrand: undefined;
	public trackingId: string | undefined;
	public organizationsList: string | undefined;
	public enterpriseList: string | undefined;
	public optedIn: boolean;

	constructor(
		trackingId: string | undefined,
		optedIn: boolean | undefined,
		@ICopilotTokenStore private readonly _tokenStore: ICopilotTokenStore,
	) {
		this.trackingId = trackingId;
		this.optedIn = optedIn ?? false;
		this.updateFromToken(this._tokenStore.dardcorToken);
		this._tokenStore.onDidStoreUpdate(() => {
			this.updateFromToken(this._tokenStore.dardcorToken);
		});
	}

	private updateFromToken(token: CopilotToken | undefined) {
		if (!token) {
			return;
		}
		const enhancedTelemetry = token.getTokenValue('rt') === '1';
		const trackingId = token.getTokenValue('tid');
		if (trackingId !== undefined) {
			this.trackingId = trackingId;
			this.organizationsList = token.organizationList.toString();
			this.enterpriseList = token.enterpriseList.toString();
			this.optedIn = enhancedTelemetry;
		}
	}
}

export type TelemetryProperties = { [key: string]: string };

export type AdditionalTelemetryProperties = { [key: string]: string };

export function createTrackingIdGetter(tokenStore: ICopilotTokenStore): () => string | undefined {
	let cachedTrackingId = tokenStore.dardcorToken?.getTokenValue('tid');
	tokenStore.onDidStoreUpdate(() => {
		const trackingId = tokenStore.dardcorToken?.getTokenValue('tid');
		if (trackingId) {
			cachedTrackingId = trackingId;
		}
	});
	return () => cachedTrackingId;
}

export type TelemetryDestination = {
	github: boolean | { eventNamePrefix: string };
	microsoft: boolean;
};

export interface ITelemetryService extends IExperimentationTelemetry, IDisposable {
	readonly _serviceBrand: undefined;
	sendInternalMSFTTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendMSFTTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendMSFTTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendGHTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendGHTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendGHTelemetryException(maybeError: unknown, origin: string): void;
	sendEnhancedGHTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendEnhancedGHTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendTelemetryEvent(eventName: string, destination: TelemetryDestination, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendTelemetryEvent<TTelemetryEvent extends ITelemetryEvent>(eventName: TTelemetryEvent['eventName'], destination: TelemetryDestination, properties?: TTelemetryEvent['properties'], measurements?: TTelemetryEvent['measurements']): void;
	sendTelemetryErrorEvent(eventName: string, destination: TelemetryDestination, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;

	setAdditionalExpAssignments(expAssignments: string[]): void;
}

export interface ITelemetryEvent {
	eventName: string;
	properties?: object;
	measurements?: object;
}

export interface ITelemetrySender extends IDisposable {
	sendTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
	sendTelemetryErrorEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
}

export const ITelemetryService = createServiceIdentifier<ITelemetryService>('ITelemetryService');
export interface IMSFTTelemetrySender extends ITelemetrySender {
	sendInternalTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void;
}
export interface IGHTelemetryService {
	readonly _serviceBrand: undefined;
	setSecureReporter(reporter: TelemetrySender | undefined): void;
	setReporter(reporter: TelemetrySender | undefined): void;

	sendTelemetry(name: string, telemetryData?: TelemetryData): Promise<void>;

	sendErrorTelemetry(name: string, telemetryData?: TelemetryData): Promise<void>;

	sendEnhancedTelemetry(name: string, telemetryData?: TelemetryData): Promise<void>;

	sendEnhancedErrorTelemetry(name: string, telemetryData?: TelemetryData): Promise<void>;

	sendExpProblemTelemetry(telemetryProperties: { reason: string }): Promise<void>;
	sendExceptionTelemetry(maybeError: unknown, origin: string): Promise<void>;
	deactivate(): Promise<void>;
}

export class TelemetryTrustedValue<T> {
	public readonly isTrustedTelemetryValue = true;
	constructor(public readonly value: T) { }
}


const MAX_PROPERTY_LENGTH = 8192;
const MAX_CONCATENATED_PROPERTIES = 50;

const COMPRESSED_CHUNK_SUFFIX = 'Chunk';

const ALWAYS_COMPRESSED_CHUNK_KEYS = new Set<string>(['messagesJson', 'diffsJSON']);

let defaultCompressor: ((value: string) => Promise<string>) | undefined;

export function setTelemetryPropertyCompressor(compress: (value: string) => Promise<string>): void {
	defaultCompressor = compress;
}

export async function multiplexProperties(
	properties: { [key: string]: string | undefined },
	compress: ((value: string) => Promise<string>) | undefined = defaultCompressor
): Promise<{ [key: string]: string | undefined }> {
	const newProperties = { ...properties };
	for (const key in properties) {
		const value = properties[key];
		const valueLength = value?.length ?? 0;
		const forceCompress = !!compress && value !== undefined && ALWAYS_COMPRESSED_CHUNK_KEYS.has(key);
		if (valueLength <= MAX_PROPERTY_LENGTH && !forceCompress) {
			continue;
		}
		if (compress) {
			newProperties[key] = value!.slice(0, MAX_PROPERTY_LENGTH);
			const compressed = await compress(value!);
			for (let offset = 0, index = 1; offset < compressed.length && index <= MAX_CONCATENATED_PROPERTIES; offset += MAX_PROPERTY_LENGTH, index++) {
				const columnName = index === 1 ? `${key}${COMPRESSED_CHUNK_SUFFIX}` : `${key}${COMPRESSED_CHUNK_SUFFIX}_${index}`;
				newProperties[columnName] = compressed.slice(offset, offset + MAX_PROPERTY_LENGTH);
			}
			continue;
		}
		let remaining = valueLength;
		let start = 0;
		let count = 0;
		while (remaining > 0 && count < MAX_CONCATENATED_PROPERTIES) {
			count += 1;
			const columnName = count > 1 ? key + '_' + (count < 10 ? '0' : '') + count : key;
			const end = remaining < MAX_PROPERTY_LENGTH ? start + remaining : start + MAX_PROPERTY_LENGTH;
			newProperties[columnName] = value!.slice(start, end);
			remaining -= MAX_PROPERTY_LENGTH;
			start += MAX_PROPERTY_LENGTH;
		}
	}

	return newProperties;
}
