/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { BaseParams } from '../common/commands.js';
import type { TerminalClaim } from './state.js';


export interface CreateTerminalParams extends BaseParams {
	channel: URI;
	claim: TerminalClaim;
	name?: string;
	cwd?: URI;
	cols?: number;
	rows?: number;
}


export interface DisposeTerminalParams extends BaseParams { }
