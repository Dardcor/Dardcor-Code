/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { URI } from '../common/state.js';


export interface ResourceWatchState {
	root: URI;
	recursive: boolean;
	excludes?: { items: string[] };
	includes?: { items: string[] };
}


export const enum ResourceChangeType {
	Added = 'added',
	Updated = 'updated',
	Deleted = 'deleted',
}

export interface ResourceChange {
	uri: URI;
	type: ResourceChangeType;
}
