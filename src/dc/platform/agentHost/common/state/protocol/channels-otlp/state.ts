/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';


export interface TelemetryCapabilities {
	logs?: URI;
	traces?: URI;
	metrics?: URI;
}
