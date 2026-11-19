/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { SessionSummary } from '../channels-session/state.js';


export interface SessionAddedParams {
	channel: URI;
	summary: SessionSummary;
}


export interface SessionRemovedParams {
	channel: URI;
	session: URI;
}


export interface SessionSummaryChangedParams {
	channel: URI;
	session: URI;
	changes: Partial<SessionSummary>;
}


export interface ProgressParams {
	channel: URI;
	progressToken: string;
	progress: number;
	total?: number;
	message?: string;
}
