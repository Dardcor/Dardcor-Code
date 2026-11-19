/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { AbstractMessageLogger, format, LogLevel } from '../../../log/common/log.js';

export const OTLP_LOGS_CHANNEL_TEMPLATE = 'ahp-otlp://logs/{level}';

export const OTLP_CHANNEL_SCHEME = 'ahp-otlp';

export const OTLP_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type OtlpLogLevelName = typeof OTLP_LOG_LEVELS[number];

export function levelToSeverityNumber(level: OtlpLogLevelName): number {
	switch (level) {
		case 'trace': return 1;
		case 'debug': return 5;
		case 'info': return 9;
		case 'warn': return 13;
		case 'error': return 17;
		case 'fatal': return 21;
	}
}

export function parseOtlpLogLevel(value: string): OtlpLogLevelName | undefined {
	const lower = value.toLowerCase();
	return (OTLP_LOG_LEVELS as readonly string[]).includes(lower) ? lower as OtlpLogLevelName : undefined;
}

export function logLevelToOtlpSeverity(level: LogLevel): { severityNumber: number; severityText: OtlpLogLevelName } {
	switch (level) {
		case LogLevel.Trace: return { severityNumber: 1, severityText: 'trace' };
		case LogLevel.Debug: return { severityNumber: 5, severityText: 'debug' };
		case LogLevel.Info: return { severityNumber: 9, severityText: 'info' };
		case LogLevel.Warning: return { severityNumber: 13, severityText: 'warn' };
		case LogLevel.Error: return { severityNumber: 17, severityText: 'error' };
		case LogLevel.Off:
			return { severityNumber: 0, severityText: 'trace' };
	}
}

export function logLevelToOtlpLevelName(level: LogLevel): OtlpLogLevelName | undefined {
	if (level === LogLevel.Off) {
		return undefined;
	}
	return logLevelToOtlpSeverity(level).severityText;
}

export function severityNumberToLogLevel(severityNumber: number): LogLevel {
	if (severityNumber >= 17) { return LogLevel.Error; }
	if (severityNumber >= 13) { return LogLevel.Warning; }
	if (severityNumber >= 9) { return LogLevel.Info; }
	if (severityNumber >= 5) { return LogLevel.Debug; }
	return LogLevel.Trace;
}

export type OtelAttributeValue = string | number | boolean;

export class OtelData {
	constructor(readonly attributes: Readonly<Record<string, OtelAttributeValue>>) { }

	toJSON(): Readonly<Record<string, OtelAttributeValue>> {
		return this.attributes;
	}
}

export interface IOtlpLogRecord {
	readonly timeUnixNano: string;
	readonly severityNumber: number;
	readonly severityText: OtlpLogLevelName;
	readonly body: string;
	readonly attributes?: Readonly<Record<string, OtelAttributeValue>>;
}

export class OtlpLogEmitter extends Disposable {

	private readonly _onDidLog = this._register(new Emitter<IOtlpLogRecord>());
	readonly onDidLog: Event<IOtlpLogRecord> = this._onDidLog.event;

	emit(record: IOtlpLogRecord): void {
		this._onDidLog.fire(record);
	}
}

export class OtlpEmitterLogger extends AbstractMessageLogger {

	constructor(
		private readonly _emitter: OtlpLogEmitter,
		initialLevel: LogLevel = LogLevel.Trace,
	) {
		super();
		this.setLevel(initialLevel);
	}

	override trace(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Trace)) {
			this._emit(LogLevel.Trace, message, args, true);
		}
	}

	override debug(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Debug)) {
			this._emit(LogLevel.Debug, message, args);
		}
	}

	override info(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Info)) {
			this._emit(LogLevel.Info, message, args);
		}
	}

	override warn(message: string, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Warning)) {
			this._emit(LogLevel.Warning, message, args);
		}
	}

	override error(message: string | Error, ...args: unknown[]): void {
		if (this.canLog(LogLevel.Error)) {
			const head = message instanceof Error ? message.stack ?? message.message : message;
			this._emit(LogLevel.Error, head, args);
		}
	}

	protected override log(level: LogLevel, message: string): void {
		if (level === LogLevel.Off) {
			return;
		}
		this._emit(level, message, []);
	}

	private _emit(level: LogLevel, message: string, args: unknown[], verbose = false): void {
		let attributes: Readonly<Record<string, OtelAttributeValue>> | undefined;
		const index = args.findIndex(arg => arg instanceof OtelData);
		if (index !== -1) {
			attributes = (args[index] as OtelData).attributes;
			args = args.slice(0, index).concat(args.slice(index + 1));
		}
		const { severityNumber, severityText } = logLevelToOtlpSeverity(level);
		this._emitter.emit({
			timeUnixNano: msToUnixNano(Date.now()),
			severityNumber,
			severityText,
			body: format([message, ...args], verbose),
			...(attributes ? { attributes } : undefined),
		});
	}
}

export function toResourceLogsPayload(record: IOtlpLogRecord): Record<string, unknown> {
	return toResourceLogsPayloadBatch([record]);
}

export function toResourceLogsPayloadBatch(records: readonly IOtlpLogRecord[]): Record<string, unknown> {
	return {
		resourceLogs: [
			{
				resource: { attributes: [] },
				scopeLogs: [
					{
						scope: { name: 'vscode.agentHost' },
						logRecords: records.map(r => ({
							timeUnixNano: r.timeUnixNano,
							observedTimeUnixNano: r.timeUnixNano,
							severityNumber: r.severityNumber,
							severityText: r.severityText,
							body: { stringValue: r.body },
							...(r.attributes ? { attributes: attributesToOtlp(r.attributes) } : undefined),
						})),
					},
				],
			},
		],
	};
}

export function* iterateOtlpLogRecords(payload: unknown): IterableIterator<IOtlpLogRecord> {
	if (!payload || typeof payload !== 'object') {
		return;
	}
	const resourceLogs = (payload as { resourceLogs?: unknown }).resourceLogs;
	if (!Array.isArray(resourceLogs)) {
		return;
	}
	for (const resourceLog of resourceLogs) {
		if (!resourceLog || typeof resourceLog !== 'object') {
			continue;
		}
		const scopeLogs = (resourceLog as { scopeLogs?: unknown }).scopeLogs;
		if (!Array.isArray(scopeLogs)) {
			continue;
		}
		for (const scopeLog of scopeLogs) {
			if (!scopeLog || typeof scopeLog !== 'object') {
				continue;
			}
			const logRecords = (scopeLog as { logRecords?: unknown }).logRecords;
			if (!Array.isArray(logRecords)) {
				continue;
			}
			for (const raw of logRecords) {
				const record = coerceLogRecord(raw);
				if (record) {
					yield record;
				}
			}
		}
	}
}

function coerceLogRecord(raw: unknown): IOtlpLogRecord | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const r = raw as Record<string, unknown>;
	const severityNumber = typeof r.severityNumber === 'number' ? r.severityNumber : 0;
	const severityTextRaw = typeof r.severityText === 'string' ? r.severityText.toLowerCase() : '';
	const severityText = parseOtlpLogLevel(severityTextRaw) ?? severityNameFromNumber(severityNumber);
	const timeUnixNano = typeof r.timeUnixNano === 'string'
		? r.timeUnixNano
		: typeof r.observedTimeUnixNano === 'string' ? r.observedTimeUnixNano : '0';
	const body = extractBody(r.body);
	const attributes = otlpToAttributes(r.attributes);
	return attributes
		? { timeUnixNano, severityNumber, severityText, body, attributes }
		: { timeUnixNano, severityNumber, severityText, body };
}

function attributesToOtlp(attributes: Readonly<Record<string, OtelAttributeValue>>): Array<{ key: string; value: Record<string, unknown> }> {
	return Object.entries(attributes).map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

function toAnyValue(value: OtelAttributeValue): Record<string, unknown> {
	switch (typeof value) {
		case 'boolean': return { boolValue: value };
		case 'number': return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
		default: return { stringValue: value };
	}
}

function otlpToAttributes(raw: unknown): Record<string, OtelAttributeValue> | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	const result: Record<string, OtelAttributeValue> = {};
	for (const entry of raw) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const key = (entry as { key?: unknown }).key;
		if (typeof key !== 'string') {
			continue;
		}
		const value = fromAnyValue((entry as { value?: unknown }).value);
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return Object.keys(result).length > 0 ? result : undefined;
}

function fromAnyValue(value: unknown): OtelAttributeValue | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const v = value as Record<string, unknown>;
	if (typeof v.stringValue === 'string') { return v.stringValue; }
	if (typeof v.boolValue === 'boolean') { return v.boolValue; }
	if (typeof v.intValue === 'number') { return Number.isSafeInteger(v.intValue) ? v.intValue : undefined; }
	if (typeof v.intValue === 'string') {
		const parsed = Number(v.intValue);
		return Number.isSafeInteger(parsed) ? parsed : undefined;
	}
	if (typeof v.doubleValue === 'number') { return Number.isFinite(v.doubleValue) ? v.doubleValue : undefined; }
	return undefined;
}

function severityNameFromNumber(n: number): OtlpLogLevelName {
	if (n >= 21) { return 'fatal'; }
	if (n >= 17) { return 'error'; }
	if (n >= 13) { return 'warn'; }
	if (n >= 9) { return 'info'; }
	if (n >= 5) { return 'debug'; }
	return 'trace';
}

function extractBody(body: unknown): string {
	if (typeof body === 'string') {
		return body;
	}
	if (body && typeof body === 'object') {
		const value = (body as { stringValue?: unknown }).stringValue;
		if (typeof value === 'string') {
			return value;
		}
	}
	return '';
}

function msToUnixNano(ms: number): string {
	return `${ms}000000`;
}

export function extractLevelFromOtlpLogsUri(uri: string): OtlpLogLevelName | undefined {
	const match = /^ahp-otlp:\/\/logs\/([^/?#]+)/i.exec(uri);
	if (!match) {
		return undefined;
	}
	return parseOtlpLogLevel(match[1]);
}

export function buildOtlpLogsChannelUri(level: OtlpLogLevelName): string {
	return `ahp-otlp://logs/${level}`;
}
