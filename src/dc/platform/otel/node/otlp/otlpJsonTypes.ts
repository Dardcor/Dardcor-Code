/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/



export const enum OtlpStatusCode {
	UNSET = 0,
	OK = 1,
	ERROR = 2,
}

export const enum OtlpSpanKind {
	UNSPECIFIED = 0,
	INTERNAL = 1,
	SERVER = 2,
	CLIENT = 3,
	PRODUCER = 4,
	CONSUMER = 5,
}

export interface IOtlpAnyValue {
	readonly stringValue?: string;
	readonly boolValue?: boolean;
	readonly intValue?: string | number;
	readonly doubleValue?: number;
	readonly arrayValue?: { readonly values?: readonly IOtlpAnyValue[] };
	readonly kvlistValue?: { readonly values?: readonly IOtlpKeyValue[] };
	readonly bytesValue?: string;
}

export interface IOtlpKeyValue {
	readonly key: string;
	readonly value?: IOtlpAnyValue;
}

export interface IOtlpStatus {
	readonly code?: OtlpStatusCode;
	readonly message?: string;
}

export interface IOtlpEvent {
	readonly timeUnixNano?: string;
	readonly name?: string;
	readonly attributes?: readonly IOtlpKeyValue[];
	readonly droppedAttributesCount?: number;
}

export interface IOtlpLink {
	readonly traceId?: string;
	readonly spanId?: string;
	readonly traceState?: string;
	readonly attributes?: readonly IOtlpKeyValue[];
	readonly droppedAttributesCount?: number;
	readonly flags?: number;
}

export interface IOtlpSpan {
	readonly traceId: string;
	readonly spanId: string;
	readonly traceState?: string;
	readonly parentSpanId?: string;
	readonly flags?: number;
	readonly name?: string;
	readonly kind?: OtlpSpanKind;
	readonly startTimeUnixNano?: string;
	readonly endTimeUnixNano?: string;
	readonly attributes?: readonly IOtlpKeyValue[];
	readonly droppedAttributesCount?: number;
	readonly events?: readonly IOtlpEvent[];
	readonly droppedEventsCount?: number;
	readonly links?: readonly IOtlpLink[];
	readonly droppedLinksCount?: number;
	readonly status?: IOtlpStatus;
}

export interface IOtlpInstrumentationScope {
	readonly name?: string;
	readonly version?: string;
	readonly attributes?: readonly IOtlpKeyValue[];
	readonly droppedAttributesCount?: number;
}

export interface IOtlpScopeSpans {
	readonly scope?: IOtlpInstrumentationScope;
	readonly spans?: readonly IOtlpSpan[];
	readonly schemaUrl?: string;
}

export interface IOtlpResource {
	readonly attributes?: readonly IOtlpKeyValue[];
	readonly droppedAttributesCount?: number;
}

export interface IOtlpResourceSpans {
	readonly resource?: IOtlpResource;
	readonly scopeSpans?: readonly IOtlpScopeSpans[];
	readonly schemaUrl?: string;
}

export interface IOtlpExportTraceServiceRequest {
	readonly resourceSpans?: readonly IOtlpResourceSpans[];
}

export interface IOtlpExportTraceServiceResponse {
	readonly partialSuccess?: {
		readonly rejectedSpans?: number;
		readonly errorMessage?: string;
	};
}
