/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ActionType } from '../common/actions.js';
import type { Message } from '../channels-chat/state.js';
import type { URI } from '../common/state.js';
import type { AutomationDefinition, AutomationEntry, AutomationSessionTemplate, AutomationTrigger } from './state.js';

export interface AutomationDefinitionPatch {
	title?: string;
	message?: Message;
	session?: AutomationSessionTemplate;
	enabled?: boolean;
	triggers?: AutomationTrigger[];
	_meta?: Record<string, unknown>;
}

export interface AutomationCreateRequestedAction {
	type: ActionType.AutomationCreateRequested;
	resource: URI;
	definition: AutomationDefinition;
}

export interface AutomationUpdateRequestedAction {
	type: ActionType.AutomationUpdateRequested;
	resource: URI;
	changes: AutomationDefinitionPatch;
}

export interface AutomationSetAction {
	type: ActionType.AutomationSet;
	automation: AutomationEntry;
}

export interface AutomationRemovedAction {
	type: ActionType.AutomationRemoved;
	resource: URI;
}
