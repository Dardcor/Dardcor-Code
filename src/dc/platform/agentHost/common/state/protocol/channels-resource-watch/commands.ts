/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';
import type { BaseParams } from '../common/commands.js';


export interface CreateResourceWatchParams extends BaseParams {
	channel: 'ahp-root://';
	uri: URI;
	recursive?: boolean;
	excludes?: { items: string[] };
	includes?: { items: string[] };
}

export interface CreateResourceWatchResult {
	channel: URI;
}
