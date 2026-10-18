/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export const enum SpanStatusCode {
	UNSET = 0,
	OK = 1,
	ERROR = 2,
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
