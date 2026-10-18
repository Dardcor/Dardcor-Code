/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ICompletedSpanData, ISpanEventRecord, SpanStatusCode } from '../../../platform/otel/common/otelService';


interface OtlpAttribute {
	key: string;
	value: OtlpAnyValue;
}

interface OtlpAnyValue {
	stringValue?: string;
	intValue?: string;
	boolValue?: boolean;
	arrayValue?: { values: OtlpAnyValue[] };
}

interface OtlpSpanEvent {
	timeUnixNano: string;
	name: string;
	attributes?: OtlpAttribute[];
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes?: OtlpAttribute[];
	events?: OtlpSpanEvent[];
	status?: { code?: number; message?: string };
}

interface OtlpScopeSpans {
	scope?: { name?: string; version?: string };
	spans: OtlpSpan[];
}

interface OtlpResourceSpans {
	resource?: { attributes?: OtlpAttribute[] };
	scopeSpans: OtlpScopeSpans[];
}

export interface OtlpExport {
	resourceSpans: OtlpResourceSpans[];
}

export interface CopilotChatExportExtension {
	exportedAt: string;
	exporterVersion: string;
	sessionId: string;
	sessionTitle?: string;
}

export interface ChatDebugLogExport extends OtlpExport {
	dardcorChat?: CopilotChatExportExtension;
}


export function completedSpanToOtlpSpan(span: ICompletedSpanData): OtlpSpan {
	return {
		traceId: span.traceId,
		spanId: span.spanId,
		...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
		name: span.name,
		kind: 1,
		startTimeUnixNano: msToNanoString(span.startTime),
		endTimeUnixNano: msToNanoString(span.endTime),
		attributes: recordToOtlpAttributes(span.attributes),
		events: span.events.map(spanEventToOtlp),
		status: { code: span.status.code, ...(span.status.message ? { message: span.status.message } : {}) },
	};
}

export function wrapInResourceSpans(
	spans: readonly ICompletedSpanData[],
	resource: Record<string, string>,
): OtlpExport {
	return {
		resourceSpans: [{
			resource: {
				attributes: Object.entries(resource).map(([key, value]) => ({
					key,
					value: { stringValue: value },
				})),
			},
			scopeSpans: [{
				scope: { name: 'dardcor-chat' },
				spans: spans.map(completedSpanToOtlpSpan),
			}],
		}],
	};
}


export function parseResourceSpans(jsonStr: string): ICompletedSpanData[] {
	const spans: ICompletedSpanData[] = [];

	try {
		const parsed = JSON.parse(jsonStr);
		if (parsed.resourceSpans) {
			return extractSpansFromOtlp(parsed as OtlpExport);
		}
	} catch { }

	const lines = jsonStr.split('\n').filter(l => l.trim());
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);
			if (parsed.resourceSpans) {
				spans.push(...extractSpansFromOtlp(parsed as OtlpExport));
			}
		} catch { }
	}

	return spans;
}

function extractSpansFromOtlp(otlp: OtlpExport): ICompletedSpanData[] {
	const spans: ICompletedSpanData[] = [];
	for (const rs of otlp.resourceSpans) {
		for (const ss of rs.scopeSpans) {
			for (const otlpSpan of ss.spans) {
				spans.push(otlpSpanToCompletedSpan(otlpSpan));
			}
		}
	}
	return spans;
}

export function otlpSpanToCompletedSpan(otlpSpan: OtlpSpan): ICompletedSpanData {
	return {
		name: otlpSpan.name,
		spanId: otlpSpan.spanId,
		traceId: otlpSpan.traceId,
		parentSpanId: otlpSpan.parentSpanId,
		startTime: nanoStringToMs(otlpSpan.startTimeUnixNano),
		endTime: nanoStringToMs(otlpSpan.endTimeUnixNano),
		status: {
			code: (otlpSpan.status?.code ?? 0) as SpanStatusCode,
			message: otlpSpan.status?.message,
		},
		attributes: otlpAttributesToRecord(otlpSpan.attributes ?? []),
		events: (otlpSpan.events ?? []).map(otlpEventToSpanEvent),
	};
}


function recordToOtlpAttributes(attrs: Readonly<Record<string, string | number | boolean | string[]>>): OtlpAttribute[] {
	return Object.entries(attrs).map(([key, value]) => ({
		key,
		value: valueToOtlpAnyValue(value),
	}));
}

function valueToOtlpAnyValue(value: string | number | boolean | string[]): OtlpAnyValue {
	if (typeof value === 'string') { return { stringValue: value }; }
	if (typeof value === 'number') {
		return Number.isInteger(value) ? { intValue: String(value) } : { stringValue: String(value) };
	}
	if (typeof value === 'boolean') { return { boolValue: value }; }
	if (Array.isArray(value)) {
		return { arrayValue: { values: value.map(v => ({ stringValue: v })) } };
	}
	return { stringValue: String(value) };
}

function otlpAttributesToRecord(attrs: OtlpAttribute[]): Record<string, string | number | boolean | string[]> {
	const result: Record<string, string | number | boolean | string[]> = {};
	for (const attr of attrs) {
		result[attr.key] = otlpAnyValueToValue(attr.value);
	}
	return result;
}

function otlpAnyValueToValue(v: OtlpAnyValue): string | number | boolean | string[] {
	if (v.stringValue !== undefined) { return v.stringValue; }
	if (v.intValue !== undefined) {
		const n = Number(v.intValue);
		return Number.isFinite(n) ? n : v.intValue;
	}
	if (v.boolValue !== undefined) { return v.boolValue; }
	if (v.arrayValue) {
		return v.arrayValue.values.map(val => val.stringValue ?? String(val.intValue ?? val.boolValue ?? ''));
	}
	return '';
}

function spanEventToOtlp(event: ISpanEventRecord): OtlpSpanEvent {
	return {
		timeUnixNano: msToNanoString(event.timestamp),
		name: event.name,
		...(event.attributes ? { attributes: recordToOtlpAttributes(event.attributes) } : {}),
	};
}

function otlpEventToSpanEvent(otlpEvent: OtlpSpanEvent): ISpanEventRecord {
	return {
		name: otlpEvent.name,
		timestamp: nanoStringToMs(otlpEvent.timeUnixNano),
		attributes: otlpEvent.attributes ? otlpAttributesToRecord(otlpEvent.attributes) : undefined,
	};
}

function msToNanoString(ms: number): string {
	return String(BigInt(Math.round(ms)) * 1_000_000n);
}

function nanoStringToMs(nanos: string): number {
	return Number(BigInt(nanos) / 1_000_000n);
}
