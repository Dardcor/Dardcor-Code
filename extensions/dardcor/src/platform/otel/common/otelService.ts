/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';
import type { Event } from '../../../util/dardcor/base/common/event';
import type { OTelConfig } from './otelConfig';

export const IOTelService = createServiceIdentifier<IOTelService>('IOTelService');

export interface TraceContext {
	readonly traceId: string;
	readonly spanId: string;
	readonly traceFlags?: number;
	readonly traceState?: string;
}

export interface IOTelService {
	readonly _serviceBrand: undefined;
	readonly config: OTelConfig;

	startSpan(name: string, options?: SpanOptions): ISpanHandle;

	startActiveSpan<T>(name: string, options: SpanOptions, fn: (span: ISpanHandle) => Promise<T>): Promise<T>;

	getActiveTraceContext(): TraceContext | undefined;

	storeTraceContext(key: string, context: TraceContext): void;

	getStoredTraceContext(key: string): TraceContext | undefined;

	runWithTraceContext<T>(traceContext: TraceContext, fn: () => Promise<T>): Promise<T>;

	recordMetric(name: string, value: number, attributes?: Record<string, string | number | boolean>): void;

	incrementCounter(name: string, value?: number, attributes?: Record<string, string | number | boolean>): void;

	emitLogRecord(body: string, attributes?: Record<string, unknown>): void;

	flush(): Promise<void>;

	shutdown(): Promise<void>;

	/**
	 * Inject an externally-created completed span into the OTel service's event stream.
	 * The span will fire `onDidCompleteSpan` (for the debug panel) but will NOT be
	 * exported via the OTLP exporter (the source system handles its own export).
	 */
	injectCompletedSpan(span: ICompletedSpanData): void;

	readonly onDidCompleteSpan: Event<ICompletedSpanData>;

	readonly onDidEmitSpanEvent: Event<ISpanEventData>;
}

export const enum SpanKind {
	INTERNAL = 0,
	CLIENT = 2,
}

export const enum SpanStatusCode {
	UNSET = 0,
	OK = 1,
	ERROR = 2,
}

export interface SpanOptions {
	kind?: SpanKind;
	attributes?: Record<string, string | number | boolean | string[]>;
	parentTraceContext?: TraceContext;
}

export interface ISpanHandle {
	setAttribute(key: string, value: string | number | boolean | string[]): void;
	setAttributes(attrs: Record<string, string | number | boolean | string[] | undefined>): void;
	setStatus(code: SpanStatusCode, message?: string): void;
	recordException(error: unknown): void;
	addEvent(name: string, attributes?: Record<string, string | number | boolean | string[]>): void;
	getSpanContext(): TraceContext | undefined;
	end(): void;
}

export interface OTelModelOptions {
	readonly _capturingTokenCorrelationId?: string;
	readonly _otelTraceContext?: TraceContext | null;
	readonly _telemetryTurn?: number;
}

export interface ICompletedSpanData {
	readonly name: string;
	readonly spanId: string;
	readonly traceId: string;
	readonly parentSpanId?: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly status: { readonly code: SpanStatusCode; readonly message?: string };
	readonly attributes: Readonly<Record<string, string | number | boolean | string[]>>;
	readonly events: readonly ISpanEventRecord[];
}

export interface ISpanEventRecord {
	readonly name: string;
	readonly timestamp: number;
	readonly attributes?: Readonly<Record<string, string | number | boolean | string[]>>;
}

export interface ISpanEventData {
	readonly spanId: string;
	readonly traceId: string;
	readonly parentSpanId?: string;
	readonly eventName: string;
	readonly attributes: Readonly<Record<string, string | number | boolean | string[]>>;
	readonly timestamp: number;
}
