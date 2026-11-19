/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import type { ErrorInfo, URI, UsageInfo } from '../common/state.js';

export const enum AutomationRunStatus {
	Pending = 'pending',
	Running = 'running',
	Completed = 'completed',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

export const enum AutomationRunOriginKind {
	Manual = 'manual',
	Trigger = 'trigger',
}

export interface AutomationManualRunOrigin {
	kind: AutomationRunOriginKind.Manual;
}

export interface AutomationTriggeredRunOrigin {
	kind: AutomationRunOriginKind.Trigger;
	triggerId: string;
	scheduledFor?: string;
	catchUp?: boolean;
	event?: Record<string, unknown>;
}

export type AutomationRunOrigin =
	| AutomationManualRunOrigin
	| AutomationTriggeredRunOrigin;

export interface AutomationPendingRunLifecycle {
	status: AutomationRunStatus.Pending;
	createdAt: string;
}

export interface AutomationRunningRunLifecycle {
	status: AutomationRunStatus.Running;
	createdAt: string;
	startedAt: string;
}

export interface AutomationCompletedRunLifecycle {
	status: AutomationRunStatus.Completed;
	createdAt: string;
	startedAt: string;
	completedAt: string;
	usage?: UsageInfo;
}

export interface AutomationFailedRunLifecycle {
	status: AutomationRunStatus.Failed;
	createdAt: string;
	startedAt?: string;
	completedAt: string;
	error: ErrorInfo;
}

export interface AutomationCancelledRunLifecycle {
	status: AutomationRunStatus.Cancelled;
	createdAt: string;
	startedAt?: string;
	completedAt: string;
}

export type AutomationRunLifecycle =
	| AutomationPendingRunLifecycle
	| AutomationRunningRunLifecycle
	| AutomationCompletedRunLifecycle
	| AutomationFailedRunLifecycle
	| AutomationCancelledRunLifecycle;

export interface AutomationRunSummary {
	resource: URI;
	automation: URI;
	origin: AutomationRunOrigin;
	lifecycle: AutomationRunLifecycle;
	primarySession?: URI;
	sessionCount: number;
	_meta?: Record<string, unknown>;
}

export interface AutomationRunState {
	resource: URI;
	automation: URI;
	origin: AutomationRunOrigin;
	lifecycle: AutomationRunLifecycle;
	sessions: URI[];
	primarySession?: URI;
	_meta?: Record<string, unknown>;
}
