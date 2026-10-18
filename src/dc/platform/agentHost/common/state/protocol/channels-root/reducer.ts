/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { RootState } from './state.js';
import type { RootAction } from '../action-origin.generated.js';
import { softAssertNever } from '../common/reducer-helpers.js';

export function rootReducer(state: RootState, action: RootAction, log?: (msg: string) => void): RootState {
	switch (action.type) {
		case ActionType.RootAgentsChanged:
			return { ...state, agents: action.agents };

		case ActionType.RootActiveSessionsChanged:
			return { ...state, activeSessions: action.activeSessions };

		case ActionType.RootTerminalsChanged:
			return { ...state, terminals: action.terminals };

		case ActionType.RootConfigChanged:
			if (!state.config) {
				return state;
			}
			return {
				...state,
				config: {
					...state.config,
					values: action.replace ? { ...action.config } : { ...state.config.values, ...action.config },
				},
			};

		default:
			softAssertNever(action, log);
			return state;
	}
}
