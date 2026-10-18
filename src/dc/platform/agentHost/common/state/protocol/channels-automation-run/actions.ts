/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { URI } from '../common/state.js';
import type { AutomationRunLifecycle } from './state.js';

export interface AutomationRunLifecycleChangedAction {
	type: ActionType.AutomationRunLifecycleChanged;
	lifecycle: AutomationRunLifecycle;
}

export interface AutomationRunSessionSetAction {
	type: ActionType.AutomationRunSessionSet;
	session: URI;
}

export interface AutomationRunSessionRemovedAction {
	type: ActionType.AutomationRunSessionRemoved;
	session: URI;
}

export interface AutomationRunPrimarySessionChangedAction {
	type: ActionType.AutomationRunPrimarySessionChanged;
	primarySession?: URI;
}

export interface AutomationRunCancelRequestedAction {
	type: ActionType.AutomationRunCancelRequested;
}
