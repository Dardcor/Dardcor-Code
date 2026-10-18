/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type OTelExporterType = 'otlp-grpc' | 'otlp-http' | 'console' | 'file';

export type OTelEnabledVia = 'policy' | 'envVar' | 'setting' | 'otlpEndpointEnvVar' | 'dbSpanExporterOnly' | 'disabled';

export const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318';

export interface OTelConfig {
	readonly enabled: boolean;
	readonly enabledExplicitly: boolean;
	readonly enabledVia: OTelEnabledVia;
	readonly exporterType: OTelExporterType;
	readonly otlpEndpoint: string;
	readonly otlpProtocol: 'grpc' | 'http/json' | 'http/protobuf';
	readonly captureContent: boolean;
	readonly maxAttributeSizeChars: number;
	readonly fileExporterPath?: string;
	readonly dbSpanExporter: boolean;
	readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
	readonly httpInstrumentation: boolean;
	readonly serviceName: string;
	readonly serviceVersion: string;
	readonly sessionId: string;
	readonly resourceAttributes: Record<string, string>;
	readonly headers: Record<string, string>;
}

function parseResourceAttributes(raw: string | undefined): Record<string, string> {
	if (!raw) {
		return {};
	}
	const result: Record<string, string> = {};
	for (const pair of raw.split(',')) {
		const eqIdx = pair.indexOf('=');
		if (eqIdx > 0) {
			const key = pair.substring(0, eqIdx).trim();
			const value = pair.substring(eqIdx + 1).trim();
			if (key) {
				result[key] = value;
			}
		}
	}
	return result;
}

function parseOtlpEndpoint(raw: string | undefined, protocol: 'grpc' | 'http'): string | undefined {
	if (!raw) {
		return undefined;
	}
	const trimmed = raw.replace(/^["']|["']$/g, '');
	try {
		const url = new URL(trimmed);
		return protocol === 'grpc' ? url.origin : url.href;
	} catch {
		return undefined;
	}
}

export interface OTelConfigInput {
	env: Record<string, string | undefined>;
	settingEnabled?: boolean;
	settingExporterType?: OTelExporterType;
	settingOtlpEndpoint?: string;
	settingCaptureContent?: boolean;
	settingMaxAttributeSizeChars?: number;
	settingOutfile?: string;
	settingDbSpanExporter?: boolean;
	settingProtocol?: string;
	policyEnabled?: boolean;
	policyExporterType?: OTelExporterType;
	policyOtlpEndpoint?: string;
	policyCaptureContent?: boolean;
	policyOutfile?: string;
	policyProtocol?: string;
	settingServiceName?: string;
	policyServiceName?: string;
	settingResourceAttributes?: Record<string, string>;
	policyResourceAttributes?: Record<string, string>;
	settingHeaders?: Record<string, string>;
	policyHeaders?: Record<string, string>;
	extensionVersion: string;
	sessionId: string;
	vscodeTelemetryLevel?: string;
}

export function resolveOTelConfig(input: OTelConfigInput): OTelConfig {
	const { env } = input;

	if (input.vscodeTelemetryLevel === 'off') {
		return createDisabledConfig(input);
	}

	const dbSpanExporter = input.settingDbSpanExporter ?? false;

	const policyMandatesOtlp = input.policyOtlpEndpoint !== undefined || input.policyExporterType !== undefined;
	const policyEndpointEnables = input.policyOtlpEndpoint !== undefined ? true : undefined;

	const enabledSignal = input.policyEnabled
		?? envBool(env['DARDCOR_OTEL_ENABLED'])
		?? input.settingEnabled
		?? policyEndpointEnables
		?? (!!env['OTEL_EXPORTER_OTLP_ENDPOINT']);
	const enabled = input.policyEnabled === false ? false : enabledSignal || dbSpanExporter;

	const enabledExplicitly = enabled && enabledSignal === true;

	if (!enabled) {
		return createDisabledConfig(input);
	}

	let enabledVia: OTelEnabledVia;
	if (input.policyEnabled === true || (input.policyEnabled === undefined && input.policyOtlpEndpoint !== undefined)) {
		enabledVia = 'policy';
	} else if (envBool(env['DARDCOR_OTEL_ENABLED']) === true) {
		enabledVia = 'envVar';
	} else if (input.settingEnabled === true) {
		enabledVia = 'setting';
	} else if (!!env['OTEL_EXPORTER_OTLP_ENDPOINT']) {
		enabledVia = 'otlpEndpointEnvVar';
	} else {
		enabledVia = 'dbSpanExporterOnly';
	}

	const rawProtocol = input.policyExporterType === 'otlp-grpc'
		? 'grpc'
		: input.policyExporterType === 'otlp-http'
			? 'http'
			: (env['OTEL_EXPORTER_OTLP_PROTOCOL'] ?? env['DARDCOR_OTEL_PROTOCOL']
				?? (input.settingExporterType === 'otlp-grpc' ? 'grpc' : input.settingExporterType === 'otlp-http' ? 'http' : undefined));
	const protocol: 'grpc' | 'http' = rawProtocol === 'grpc' ? 'grpc' : 'http';

	const rawWireProtocol = input.policyProtocol
		?? env['OTEL_EXPORTER_OTLP_PROTOCOL']
		?? env['DARDCOR_OTEL_PROTOCOL']
		?? input.settingProtocol;
	const otlpProtocol: OTelConfig['otlpProtocol'] = protocol === 'grpc'
		? 'grpc'
		: rawWireProtocol === 'http/protobuf'
			? 'http/protobuf'
			: 'http/json';

	const rawEndpoint = input.policyOtlpEndpoint
		?? env['DARDCOR_OTEL_ENDPOINT']
		?? env['OTEL_EXPORTER_OTLP_ENDPOINT']
		?? input.settingOtlpEndpoint
		?? DEFAULT_OTLP_ENDPOINT;
	const otlpEndpoint = parseOtlpEndpoint(rawEndpoint, protocol) ?? DEFAULT_OTLP_ENDPOINT;

	const fileExporterPath = input.policyOutfile !== undefined
		? input.policyOutfile || undefined
		: policyMandatesOtlp
			? undefined
			: env['DARDCOR_OTEL_FILE_EXPORTER_PATH'] ?? input.settingOutfile;

	let exporterType: OTelExporterType;
	if (input.policyExporterType) {
		exporterType = input.policyExporterType;
	} else if (policyMandatesOtlp) {
		exporterType = 'otlp-http';
	} else if (fileExporterPath) {
		exporterType = 'file';
	} else if (input.settingExporterType) {
		exporterType = input.settingExporterType;
	} else {
		exporterType = protocol === 'grpc' ? 'otlp-grpc' : 'otlp-http';
	}

	const captureContent = input.policyCaptureContent
		?? envBool(env['DARDCOR_OTEL_CAPTURE_CONTENT'])
		?? input.settingCaptureContent
		?? false;

	const maxAttributeSizeChars = parseMaxAttributeSizeChars(env['DARDCOR_OTEL_MAX_ATTRIBUTE_SIZE_CHARS'])
		?? input.settingMaxAttributeSizeChars
		?? 0;

	const validLogLevels = new Set<OTelConfig['logLevel']>(['trace', 'debug', 'info', 'warn', 'error']);
	const rawLogLevel = env['DARDCOR_OTEL_LOG_LEVEL'];
	const logLevel: OTelConfig['logLevel'] = rawLogLevel && validLogLevels.has(rawLogLevel as OTelConfig['logLevel'])
		? rawLogLevel as OTelConfig['logLevel']
		: 'info';

	const httpInstrumentation = envBool(env['DARDCOR_OTEL_HTTP_INSTRUMENTATION']) ?? false;

	const serviceName = (input.policyServiceName || undefined)
		?? env['OTEL_SERVICE_NAME']
		?? (input.settingServiceName || undefined)
		?? 'dardcor-chat';

	const resourceAttributes = {
		...(input.settingResourceAttributes ?? {}),
		...parseResourceAttributes(env['OTEL_RESOURCE_ATTRIBUTES']),
		...(input.policyResourceAttributes ?? {}),
	};

	const headers = {
		...(input.settingHeaders ?? {}),
		...parseResourceAttributes(env['OTEL_EXPORTER_OTLP_HEADERS']),
		...(input.policyHeaders ?? {}),
	};

	return Object.freeze({
		enabled: true,
		enabledExplicitly,
		enabledVia,
		exporterType,
		otlpEndpoint,
		otlpProtocol,
		captureContent,
		maxAttributeSizeChars: maxAttributeSizeChars < 0 ? 0 : maxAttributeSizeChars,
		fileExporterPath,
		dbSpanExporter,
		logLevel,
		httpInstrumentation,
		serviceName,
		serviceVersion: input.extensionVersion,
		sessionId: input.sessionId,
		resourceAttributes,
		headers,
	});
}

function createDisabledConfig(input: OTelConfigInput): OTelConfig {
	return Object.freeze({
		enabled: false,
		enabledExplicitly: false,
		enabledVia: 'disabled' as const,
		exporterType: 'otlp-http' as const,
		otlpEndpoint: '',
		otlpProtocol: 'http/json' as const,
		captureContent: false,
		maxAttributeSizeChars: 0,
		dbSpanExporter: false,
		logLevel: 'info' as const,
		httpInstrumentation: false,
		serviceName: 'dardcor-chat',
		serviceVersion: input.extensionVersion,
		sessionId: input.sessionId,
		resourceAttributes: {},
		headers: {},
	});
}

function envBool(val: string | undefined): boolean | undefined {
	if (val === undefined) {
		return undefined;
	}
	return val === 'true' || val === '1';
}

function parseMaxAttributeSizeChars(val: string | undefined): number | undefined {
	if (val === undefined || val === '') {
		return undefined;
	}
	const n = Number(val);
	if (!Number.isSafeInteger(n)) {
		return undefined;
	}
	return n;
}
