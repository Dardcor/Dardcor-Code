/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';


export interface OtlpExportLogsParams {
	channel: URI;
	payload: Record<string, unknown>;
}


export interface OtlpExportTracesParams {
	channel: URI;
	payload: Record<string, unknown>;
}


export interface OtlpExportMetricsParams {
	channel: URI;
	payload: Record<string, unknown>;
}
