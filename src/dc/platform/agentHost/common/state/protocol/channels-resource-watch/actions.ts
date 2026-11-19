/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { ResourceChange } from './state.js';


export interface ResourceWatchChangedAction {
	type: ActionType.ResourceWatchChanged;
	changes: { items: ResourceChange[] };
}
