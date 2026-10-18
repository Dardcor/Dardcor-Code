/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { Message } from '../channels-chat/state.js';
import type { ConfigSchema, URI } from '../common/state.js';
import type { AutomationRunSummary } from '../channels-automation-run/state.js';
import type { ModelSelection } from '../channels-root/state.js';
import type { AgentSelection } from '../channels-session/state.js';

export const enum AutomationOperation {
	Update = 'update',
	Remove = 'remove',
	Run = 'run',
}

export interface AutomationSchedule {
	expression: string;
	timeZone: string;
}

export const enum AutomationMisfirePolicy {
	Skip = 'skip',
	RunOnce = 'runOnce',
}

export const enum AutomationTriggerKind {
	Schedule = 'schedule',
	Event = 'event',
}

export interface AutomationScheduleTrigger {
	id: string;
	kind: AutomationTriggerKind.Schedule;
	schedule: AutomationSchedule;
	misfirePolicy?: AutomationMisfirePolicy;
}

export interface AutomationEventTrigger {
	id: string;
	kind: AutomationTriggerKind.Event;
	type: string;
	title: string;
	description?: string;
	events: AutomationTriggerEventDefinition[];
	config?: Record<string, unknown>;
}

export type AutomationTrigger =
	| AutomationScheduleTrigger
	| AutomationEventTrigger;

export interface AutomationTriggerEventDefinition {
	id: string;
	title: string;
	description?: string;
}

export interface AutomationTriggerDefinition {
	type: string;
	title: string;
	description?: string;
	events: AutomationTriggerEventDefinition[];
	configSchema?: ConfigSchema;
}

export interface AutomationSessionTemplate {
	provider?: string;
	model?: ModelSelection;
	agent?: AgentSelection;
	workingDirectories?: URI[];
	config?: Record<string, unknown>;
}

export interface AutomationDefinition {
	title: string;
	message: Message;
	session: AutomationSessionTemplate;
	enabled: boolean;
	triggers: AutomationTrigger[];
	_meta?: Record<string, unknown>;
}

export interface AutomationEntry {
	resource: URI;
	definition: AutomationDefinition;
	nextRunAt?: string;
	runs: AutomationRunSummary[];
	runsNextCursor?: string;
	operations: AutomationOperation[];
	createdAt: string;
	modifiedAt: string;
	_meta?: Record<string, unknown>;
}

export interface AutomationState {
	entries: AutomationEntry[];
	_meta?: Record<string, unknown>;
}
