/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as zlib from 'zlib';
import { promisify } from 'util';
import { generateUuid } from '../../../base/common/uuid.js';
import { ILogService } from '../../log/common/log.js';
import { ICommonProperties } from '../../telemetry/common/telemetry.js';

const GH_STANDARD_IKEY = '7d7048df-6dd0-4048-bb23-b716c1461f8f';
const GH_ENHANCED_IKEY = '3fdd7f28-937a-48c8-9a21-ba337db23bd1';

const GH_TELEMETRY_URL = 'https://copilot-telemetry.githubusercontent.com/telemetry';

const NAMESPACE = 'copilot-chat';

export type TelemetryProps = Record<string, string | undefined>;
export type TelemetryMeasurements = Record<string, number | undefined>;

export interface IAgentHostInternalTelemetryContext {
	readonly isInternal: boolean;
	readonly trackingId: string | undefined;
	readonly userName: string | undefined;
	readonly isVscodeTeamMember: boolean;
}

export interface IAgentHostRestrictedTelemetryContext extends IAgentHostInternalTelemetryContext {
	readonly restrictedTelemetryEnabled: boolean;
	readonly telemetryEndpoint: string | undefined;
	readonly copilotIgnoreEnabled?: boolean;
}

export interface IAgentHostInternalTelemetrySink {
	setContext(context: IAgentHostInternalTelemetryContext | undefined): void;
	send(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	sendForContext(context: IAgentHostInternalTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
}

export type FetchFn = typeof globalThis.fetch;

const MAX_PROPERTY_LENGTH = 8192;
const MAX_CONCATENATED_PROPERTIES = 50;
const MAX_TELEMETRY_ITEM_BODY_LENGTH = MAX_PROPERTY_LENGTH * MAX_CONCATENATED_PROPERTIES;

const COMPRESSED_CHUNK_SUFFIX = 'Chunk';

const ALWAYS_COMPRESSED_CHUNK_KEYS = new Set<string>(['messagesJson', 'diffsJSON']);

const gzip = promisify(zlib.gzip);

async function compressTelemetryValue(value: string): Promise<string> {
	const compressed = await gzip(Buffer.from(value, 'utf8'));
	return compressed.toString('base64');
}

export async function multiplexProperties(properties: TelemetryProps): Promise<TelemetryProps> {
	const newProperties: TelemetryProps = { ...properties };
	for (const key in properties) {
		const value = properties[key];
		const valueLength = value?.length ?? 0;
		const forceCompress = value !== undefined && ALWAYS_COMPRESSED_CHUNK_KEYS.has(key);
		if (valueLength <= MAX_PROPERTY_LENGTH && !forceCompress) {
			continue;
		}
		newProperties[key] = value!.slice(0, MAX_PROPERTY_LENGTH);
		const compressed = await compressTelemetryValue(value!);
		const compressedChunkKey = key === 'messagesJson' ? 'messagesJSON' : key;
		for (let offset = 0, index = 1; offset < compressed.length && index <= MAX_CONCATENATED_PROPERTIES; offset += MAX_PROPERTY_LENGTH, index++) {
			const columnName = index === 1 ? `${compressedChunkKey}${COMPRESSED_CHUNK_SUFFIX}` : `${compressedChunkKey}${COMPRESSED_CHUNK_SUFFIX}_${index}`;
			newProperties[columnName] = compressed.slice(offset, offset + MAX_PROPERTY_LENGTH);
		}
	}
	return newProperties;
}

export interface IAgentHostRestrictedTelemetry {
	sendGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	sendEnhancedGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	sendEnhancedGHTelemetryEventForContext(context: IAgentHostRestrictedTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	sendInternalMSFTTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	sendInternalMSFTTelemetryEventForContext(context: IAgentHostInternalTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void;
	setCopilotTrackingId(trackingId: string | undefined): void;
	setCommonProperty(name: string, value: string | boolean | undefined): void;
	setRestrictedTelemetryEndpoint(endpointUrl: string | undefined): void;
	setRestrictedTelemetryEnabled(enabled: boolean): void;
	setInternalTelemetryContext(context: IAgentHostInternalTelemetryContext | undefined): void;
}

export class AgentHostRestrictedTelemetrySender implements IAgentHostRestrictedTelemetry {

	private readonly _commonProps: TelemetryProps;

	private _restrictedTelemetryEnabled = false;
	private _internalTelemetryEnabled = false;

	constructor(
		commonProperties: ICommonProperties,
		private readonly _logService: ILogService,
		private _endpointUrl: string = GH_TELEMETRY_URL,
		private readonly _internalSink?: IAgentHostInternalTelemetrySink,
		private readonly _fetchFn: FetchFn = globalThis.fetch,
	) {
		this._commonProps = {
			client_machineid: asString(commonProperties['common.machineId']),
			client_deviceid: asString(commonProperties['common.devDeviceId']),
			client_sessionid: asString(commonProperties['sessionID']),
			common_os: asString(commonProperties['common.nodePlatform']) ?? process.platform,
			editor_version: asString(commonProperties['version']),
		};
	}

	sendGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		this._post(GH_STANDARD_IKEY, eventName, properties, measurements);
	}

	sendEnhancedGHTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (!this._restrictedTelemetryEnabled) {
			return;
		}
		this._post(GH_ENHANCED_IKEY, eventName, properties, measurements);
	}

	sendEnhancedGHTelemetryEventForContext(context: IAgentHostRestrictedTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (!context.restrictedTelemetryEnabled) {
			return;
		}
		this._post(GH_ENHANCED_IKEY, eventName, properties, measurements, {
			endpointUrl: context.telemetryEndpoint,
			trackingId: context.trackingId,
		});
	}

	sendInternalMSFTTelemetryEvent(eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (!this._internalTelemetryEnabled) {
			return;
		}
		if (this._internalSink) {
			this._internalSink.send(eventName, properties, measurements);
			return;
		}
		this._logService.trace(`[ahp-restricted] internal MSFT event (not sent, no internal key): ${eventName}`);
	}

	sendInternalMSFTTelemetryEventForContext(context: IAgentHostInternalTelemetryContext, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements): void {
		if (!context.isInternal) {
			return;
		}
		if (this._internalSink) {
			this._internalSink.sendForContext(context, eventName, properties, measurements);
			return;
		}
		this._logService.trace(`[ahp-restricted] internal MSFT event (not sent, no internal key): ${eventName}`);
	}

	setCopilotTrackingId(trackingId: string | undefined): void {
		this._commonProps.copilot_trackingId = trackingId || undefined;
	}

	setCommonProperty(name: string, value: string | boolean | undefined): void {
		if (value === undefined) {
			delete this._commonProps[name];
		} else {
			this._commonProps[name] = String(value);
		}
	}

	setRestrictedTelemetryEndpoint(endpointUrl: string | undefined): void {
		this._endpointUrl = endpointUrl || GH_TELEMETRY_URL;
	}

	setRestrictedTelemetryEnabled(enabled: boolean): void {
		this._restrictedTelemetryEnabled = enabled;
	}

	setInternalTelemetryContext(context: IAgentHostInternalTelemetryContext | undefined): void {
		this._internalTelemetryEnabled = context?.isInternal === true;
		this._internalSink?.setContext(context);
	}

	private _post(iKey: string, eventName: string, properties?: TelemetryProps, measurements?: TelemetryMeasurements, context?: { readonly endpointUrl: string | undefined; readonly trackingId: string | undefined }): void {
		const name = eventName.includes('/') ? eventName : `${NAMESPACE}/${eventName}`;
		const commonProps = context
			? { ...this._commonProps, copilot_trackingId: context.trackingId }
			: this._commonProps;
		const envelope = {
			ver: 1,
			name: `Microsoft.ApplicationInsights.${iKey.replace(/-/g, '')}.Event`,
			time: new Date().toISOString(),
			sampleRate: 100,
			seq: '',
			iKey,
			tags: { 'ai.operation.id': generateUuid() },
			data: {
				baseType: 'EventData',
				baseData: {
					name,
					properties: context
						? { unique_id: generateUuid(), ...commonProps, ...properties, copilot_trackingId: context.trackingId }
						: { unique_id: generateUuid(), ...commonProps, ...properties },
					measurements: measurements ?? {},
				},
			},
		};

		const body = JSON.stringify(envelope);
		const bodyLength = Buffer.byteLength(body, 'utf8');
		if (bodyLength > MAX_TELEMETRY_ITEM_BODY_LENGTH) {
			this._logService.trace(`[ahp-restricted] drop ${name}: serialized body is ${bodyLength} bytes (maximum ${MAX_TELEMETRY_ITEM_BODY_LENGTH})`);
			return;
		}

		this._logService.trace(`[ahp-restricted] emit ${name} (iKey ${iKey.slice(0, 8)})`);

		if (typeof this._fetchFn !== 'function') {
			this._logService.warn('[ahp-restricted] global fetch unavailable; telemetry not sent');
			return;
		}

		this._fetchFn(context?.endpointUrl || (context ? GH_TELEMETRY_URL : this._endpointUrl), {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-json-stream' },
			body,
		}).then(res => {
			if (!res.ok) {
				this._logService.warn(`[ahp-restricted] ${name} rejected: HTTP ${res.status}`);
			}
		}).catch(err => {
			this._logService.warn(`[ahp-restricted] ${name} POST failed: ${err instanceof Error ? err.message : String(err)}`);
		});
	}
}

function asString(value: string | boolean | undefined): string | undefined {
	return typeof value === 'string' ? value : value === undefined ? undefined : String(value);
}
