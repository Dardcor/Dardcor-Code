/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import type { JsonPrimitive } from '../../../../../platform/agentHost/common/state/protocol/state.js';

export type AutomationInterval = 'manual' | 'hourly' | 'daily' | 'weekly';

export interface IAutomationSchedule {
	readonly interval: AutomationInterval;

	readonly scheduleHour: number;

	readonly scheduleMinute: number;

	readonly scheduleDay: number;
}

export type AutomationWorkspaceIsolation =
	| { readonly kind: 'default' }
	| { readonly kind: 'folder' }
	| { readonly kind: 'worktree'; readonly branch: string };

export type AutomationTarget =
	| {
		readonly kind: 'workspace';
		readonly folderUri: URI;
		readonly providerId?: string;
		readonly sessionTypeId?: string;
		readonly isolation: AutomationWorkspaceIsolation;
	}
	| {
		readonly kind: 'quickChat';
		readonly providerId: string;
		readonly sessionTypeId: string;
	};

export interface IAutomationSessionTemplate {
	readonly modelId?: string;
	readonly modelConfiguration?: Readonly<Record<string, JsonPrimitive>>;
	readonly agent?: { readonly uri: string };
	readonly config?: Readonly<Record<string, unknown>>;
}

export function isAutomationModelConfiguration(value: unknown): value is NonNullable<IAutomationSessionTemplate['modelConfiguration']> {
	return !!value && typeof value === 'object' && !Array.isArray(value)
		&& (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
		&& Object.values(value).every(entry => entry === null
			|| typeof entry === 'string'
			|| typeof entry === 'boolean'
			|| (typeof entry === 'number' && Number.isFinite(entry)));
}

export function assertAutomationSessionTemplate(template: IAutomationSessionTemplate | undefined): void {
	if (template?.modelConfiguration === undefined) {
		return;
	}
	if (typeof template.modelId !== 'string' || !template.modelId.trim()) {
		throw new Error('Automation model configuration requires a model identifier.');
	}
	if (!isAutomationModelConfiguration(template.modelConfiguration)) {
		throw new Error('Automation model configuration must contain only JSON primitive values.');
	}
}

export type IAutomation = IAutomationDescriptor;

export interface IAutomationDescriptor {
	readonly id: string;
	readonly name: string;
	readonly prompt: string;
	readonly schedule: IAutomationSchedule;

	readonly target: AutomationTarget;

	readonly sessionTemplate?: IAutomationSessionTemplate;

	readonly modelId?: string;

	readonly mode?: string;

	readonly permissionLevel?: string;

	readonly enabled: boolean;

	readonly createdAt: string;
	readonly updatedAt: string;
	readonly lastRunAt?: string;

	readonly nextRunAt?: string;
}

export type AutomationRunStatus = 'pending' | 'running' | 'completed' | 'failed';

export type AutomationRunTrigger = 'schedule' | 'catch_up' | 'manual';

export interface IAutomationRun {
	readonly id: string;
	readonly automationId: string;
	readonly status: AutomationRunStatus;
	readonly trigger: AutomationRunTrigger;

	readonly sessionResource?: URI;

	readonly startedAt: string;
	readonly completedAt?: string;
	readonly errorMessage?: string;

	readonly leaderWindowId: number;
}
