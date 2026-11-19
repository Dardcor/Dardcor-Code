/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import type { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AgentSession } from '../common/agent.js';
import type { IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { toInitiatorTelemetry, type IAgentHostEventClassification, type IAgentHostEventTelemetry } from './agentHostTelemetryReporter.js';

export type StaticChangesetTelemetryKind = 'branch' | 'session' | 'uncommitted';

export type StaticChangesetOutcome = 'computed' | 'preserved' | 'gitUnavailable' | 'dbOpenFailed' | 'error';

export interface IStaticChangesetTelemetryData {
	readonly kind: StaticChangesetTelemetryKind;
	readonly outcome: StaticChangesetOutcome;
	readonly durationMs: number;
	readonly isMultiRoot: boolean;
	readonly folderCount: number;
	readonly fileCount?: number;
	readonly incrementalUsed?: boolean;
	readonly usedEditTrackerFallback?: boolean;
}

export function reportAgentHostStaticChangesetComputed(telemetryService: ITelemetryService, session: string, turnId: string | undefined, data: IStaticChangesetTelemetryData, clientContext?: IAgentHostClientTelemetryContext): void {
	reportChangesetComputed(telemetryService, session, turnId, {
		kind: data.kind,
		outcome: data.outcome,
		durationMs: data.durationMs,
		isMultiRoot: data.isMultiRoot,
		folderCount: data.folderCount,
		...(data.fileCount !== undefined ? { fileCount: data.fileCount } : {}),
		...(data.incrementalUsed !== undefined ? { incrementalUsed: data.incrementalUsed } : {}),
		...(data.usedEditTrackerFallback !== undefined ? { usedEditTrackerFallback: data.usedEditTrackerFallback } : {}),
	}, clientContext);
}

export type TurnChangesetOutcome = 'computed' | 'dbOpenFailed' | 'resolveFailed' | 'error';

export interface IMultiRootTurnDiffMetrics {
	readonly uniqueGitFolderCount: number;
	readonly nonGitFolderCount: number;
	readonly trackedEditFallbackFolderCount: number;
}

export interface ITurnChangesetTelemetryData {
	readonly outcome: TurnChangesetOutcome;
	readonly durationMs: number;
	readonly isMultiRoot: boolean;
	readonly folderCount: number;
	readonly fileCount?: number;
	readonly multiRoot?: IMultiRootTurnDiffMetrics;
}

export function reportAgentHostTurnChangesetComputed(telemetryService: ITelemetryService, session: string, turnId: string, data: ITurnChangesetTelemetryData, clientContext?: IAgentHostClientTelemetryContext): void {
	reportChangesetComputed(telemetryService, session, turnId, {
		kind: 'turn',
		outcome: data.outcome,
		durationMs: data.durationMs,
		isMultiRoot: data.isMultiRoot,
		folderCount: data.folderCount,
		...(data.fileCount !== undefined ? { fileCount: data.fileCount } : {}),
		...(data.multiRoot ? {
			uniqueGitFolderCount: data.multiRoot.uniqueGitFolderCount,
			nonGitFolderCount: data.multiRoot.nonGitFolderCount,
			trackedEditFallbackFolderCount: data.multiRoot.trackedEditFallbackFolderCount,
		} : {}),
	}, clientContext);
}

export type ChangesetComputedKind = StaticChangesetTelemetryKind | 'turn';

export type ChangesetComputedOutcome = StaticChangesetOutcome | TurnChangesetOutcome;

type ChangesetComputedEvent = IAgentHostEventTelemetry & {
	provider: string;
	agentSessionId: string;
	turnId?: string;
	kind: ChangesetComputedKind;
	outcome: ChangesetComputedOutcome;
	durationMs: number;
	isMultiRoot: boolean;
	folderCount: number;
	fileCount?: number;
	incrementalUsed?: boolean;
	usedEditTrackerFallback?: boolean;
	uniqueGitFolderCount?: number;
	nonGitFolderCount?: number;
	trackedEditFallbackFolderCount?: number;
};

type ChangesetComputedClassification = IAgentHostEventClassification & {
	provider: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The provider handling the agent host session.' };
	agentSessionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The agent host session identifier.' };
	turnId?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'For a turn changeset, the turn whose changeset was computed; for a static changeset, the turn that drove the recompute when one did (absent for truncation/refresh recomputes).' };
	kind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The changeset computed: a static slot (branch, session, or uncommitted) or a per-turn diff (turn).' };
	outcome: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The result of the compute. Static kinds: computed, preserved, gitUnavailable, dbOpenFailed, or error. Turn kind: computed, dbOpenFailed, resolveFailed, or error.' };
	durationMs: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Wall-clock time to compute the changeset, in milliseconds.' };
	isMultiRoot: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Whether the session spans more than one working directory.' };
	folderCount: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Total effective working directories for the session.' };
	fileCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'The number of changed files; present only when the changeset was computed.' };
	incrementalUsed?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether the incremental session-diff path was taken (static session kind only).' };
	usedEditTrackerFallback?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Whether the SDK edit-tracker fallback produced the diffs instead of git (static session kind only).' };
	uniqueGitFolderCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Unique git repositories resolved and diffed; multi-root turns only.' };
	nonGitFolderCount?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; isMeasurement: true; comment: 'Non-git working directories whose diff came from tracked edits; multi-root turns only.' };
	trackedEditFallbackFolderCount?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'Git repositories whose git diff was unavailable and fell back to tracked edits; multi-root turns only.' };
	owner: 'DonJayamanne';
	comment: 'Tracks how long the agent host takes to compute a changeset (branch/session/uncommitted static slots or a per-turn diff) and its outcome, to monitor multi-root changeset performance and health.';
};

function reportChangesetComputed(telemetryService: ITelemetryService, session: string, turnId: string | undefined, fields: Omit<ChangesetComputedEvent, 'provider' | 'agentSessionId' | 'turnId' | keyof IAgentHostEventTelemetry>, clientContext?: IAgentHostClientTelemetryContext): void {
	telemetryService.publicLog2<ChangesetComputedEvent, ChangesetComputedClassification>('agentHost.changesetComputed', {
		...toInitiatorTelemetry(clientContext),
		provider: URI.parse(session).scheme,
		agentSessionId: AgentSession.id(session),
		...(turnId !== undefined ? { turnId } : {}),
		...fields,
	});
}
