/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { ResourceWatchState } from './state.js';
import type { ResourceWatchAction } from '../action-origin.generated.js';

export function resourceWatchReducer(state: ResourceWatchState, action: ResourceWatchAction, log?: (msg: string) => void): ResourceWatchState {
	if (action.type === ActionType.ResourceWatchChanged) {
		return state;
	}

	(log ?? console.warn)(`Unhandled action type: ${JSON.stringify(action)}`);
	return state;
}
