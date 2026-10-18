/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../base/common/async.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, DisposableMap, toDisposable } from '../../../base/common/lifecycle.js';
import { StopWatch } from '../../../base/common/stopwatch.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import type { AgentSubagentTaskModelSource, IAgent, IAgentTurnDiagnosticSnapshot } from '../common/agent.js';
import type { SessionMode } from '../common/agentHostSchema.js';
import { createUnknownAgentHostClientTelemetryContext, type IAgentHostClientTelemetryContext } from '../common/agentHostTelemetry.js';
import { AgentHostClientType } from '../common/agentHostClientInfo.js';
import { IAgentHostClientConnectionService } from './agentHostClientConnectionService.js';
import { ILogService } from '../../log/common/log.js';
import { canRefineContributor, toolSourceKindFromContributor } from './shared/toolCallContributor.js';
import { SessionInputRequestKind } from '../common/state/protocol/state.js';
import type { ITurnTokenTotal, ToolCallContributor } from '../common/state/sessionState.js';
import { IAgentHostTelemetryReporter, type AgentHostInitiatorClientConnectionState, type AgentHostMessageOriginTelemetryKind, type AgentHostModelTelemetryKind, type AgentHostProviderDiagnosticState, type AgentHostTelemetryReporter, type AgentHostTurnFailureStage, type AgentHostTurnHangReason, type AgentHostTurnResult, type IAgentHostTurnFailure } from './agentHostTelemetryReporter.js';

export const TURN_HANG_THRESHOLD_MS = 5 * 60 * 1000;

const MAX_HANG_CHECK_WINDOWS = 6;

export const TURN_ACTIVITY_NONE = 'none';

interface IInFlightToolCall {
	readonly toolId: string;
	contributor: ToolCallContributor | undefined;
	toolSourceKind: string;
}

interface ITurnBlocker {
	readonly kind: SessionInputRequestKind;
	readonly toolCallId: string | undefined;
}

interface ITurnTiming {
	readonly stopWatch: StopWatch;
	readonly agent: IAgent;
	readonly session: string;
	readonly turnId: string;
	readonly parentTurnId: string | undefined;
	readonly parentToolCallId: string | undefined;
	model: string | undefined;
	modelTelemetryKind: AgentHostModelTelemetryKind | undefined;
	readonly modelSelectionKind: 'default' | 'auto' | 'explicit';
	readonly permissionLevel: string | undefined;
	readonly interactionMode: SessionMode | undefined;
	readonly messageOriginKind: AgentHostMessageOriginTelemetryKind | undefined;
	readonly subagentTaskModelSource: AgentSubagentTaskModelSource | undefined;
	readonly clientContext: IAgentHostClientTelemetryContext;
	readonly initiatorClientId: string | undefined;
	readonly completedModelCallIds: Set<string>;
	firstProgressMs: number | undefined;
	currentStage: AgentHostTurnFailureStage;

	quietStopWatch: StopWatch;
	lastActivityKind: string;
	readonly inFlightToolCalls: Map<string, IInFlightToolCall>;
	readonly blockers: Map<string, ITurnBlocker>;
	readonly reportedHangReasons: Set<AgentHostTurnHangReason>;
	hangReportCount: number;
	lastHangReason: AgentHostTurnHangReason | undefined;
	lastHangStopWatch: StopWatch | undefined;
	quietWindows: number;
}

interface ITurnUsage {
	billedNanoAiu?: number;
	directPromptTokenCount?: number;
	directPromptCacheTokenCount?: number;
	directCompletionTokenCount?: number;
	directBilledNanoAiu?: number;
}

export const IAgentHostTurnTracker = createDecorator<AgentHostTurnTracker>('agentHostTurnTracker');

export class AgentHostTurnTracker extends Disposable {

	declare readonly _serviceBrand: undefined;

	private readonly _turnTimings = new Map<string, ITurnTiming>();
	private readonly _turnUsages = new Map<string, ITurnUsage>();
	private readonly _hangWatchdogs = this._register(new DisposableMap<string>());
	private readonly _blockerTurnKeys = new Map<string, string>();

	private readonly _onDidStartTurn = this._register(new Emitter<string>());
	readonly onDidStartTurn: Event<string> = this._onDidStartTurn.event;

	constructor(
		@IAgentHostTelemetryReporter private readonly _reporter: AgentHostTelemetryReporter,
		@IAgentHostClientConnectionService private readonly _clientConnections: IAgentHostClientConnectionService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(toDisposable(() => {
			this._turnTimings.clear();
			this._turnUsages.clear();
			this._blockerTurnKeys.clear();
		}));
	}

	turnStarted(agent: IAgent, session: string, turnId: string, model: string | undefined, modelTelemetryKind: AgentHostModelTelemetryKind | undefined, modelSelectionKind: 'default' | 'auto' | 'explicit', permissionLevel: string | undefined, interactionMode: SessionMode | undefined, clientContext = createUnknownAgentHostClientTelemetryContext(AgentHostClientType.Unknown), initiatorClientId?: string, parentTurnId?: string, parentToolCallId?: string, messageOriginKind?: AgentHostMessageOriginTelemetryKind, subagentTaskModelSource?: AgentSubagentTaskModelSource): void {
		const key = this._key(session, turnId);
		this._turnTimings.set(key, {
			stopWatch: StopWatch.create(false),
			agent,
			session,
			turnId,
			parentTurnId,
			parentToolCallId,
			model,
			modelTelemetryKind,
			modelSelectionKind,
			permissionLevel,
			interactionMode,
			messageOriginKind,
			subagentTaskModelSource,
			clientContext,
			initiatorClientId,
			completedModelCallIds: new Set(),
			firstProgressMs: undefined,
			currentStage: 'validation',
			quietStopWatch: StopWatch.create(false),
			lastActivityKind: TURN_ACTIVITY_NONE,
			inFlightToolCalls: new Map(),
			blockers: new Map(),
			reportedHangReasons: new Set(),
			hangReportCount: 0,
			lastHangReason: undefined,
			lastHangStopWatch: undefined,
			quietWindows: 0,
		});
		this._turnUsages.set(key, {});
		this._armHangWatchdog(key);
		this._onDidStartTurn.fire(agent.id);
	}

	markFirstProgress(session: string, turnId: string): void {
		const timing = this._turnTimings.get(this._key(session, turnId));
		if (timing && timing.firstProgressMs === undefined) {
			timing.firstProgressMs = timing.stopWatch.elapsed();
		}
	}

	markActivity(session: string, turnId: string, activityKind: string): void {
		const key = this._key(session, turnId);
		const timing = this._turnTimings.get(key);
		if (!timing) {
			return;
		}
		timing.lastActivityKind = activityKind;
		this._touch(key, timing);
	}

	setCurrentStage(session: string, turnId: string, stage: AgentHostTurnFailureStage): void {
		const timing = this._turnTimings.get(this._key(session, turnId));
		if (timing) {
			timing.currentStage = stage;
		}
	}

	private _touch(key: string, timing: ITurnTiming): void {
		timing.quietStopWatch = StopWatch.create(true);
		timing.quietWindows = 0;
		this._armHangWatchdog(key);
	}

	toolCallStarted(session: string, turnId: string, toolCallId: string, toolName: string, contributor: ToolCallContributor | undefined): void {
		this._turnTimings.get(this._key(session, turnId))?.inFlightToolCalls.set(toolCallId, {
			toolId: toolName,
			contributor,
			toolSourceKind: toolSourceKindFromContributor(contributor),
		});
	}

	toolCallMetadataUpdated(session: string, turnId: string, toolCallId: string, contributor: ToolCallContributor | undefined): void {
		const inFlight = this._turnTimings.get(this._key(session, turnId))?.inFlightToolCalls.get(toolCallId);
		if (inFlight && contributor && canRefineContributor(inFlight.contributor, contributor)) {
			inFlight.contributor = contributor;
			inFlight.toolSourceKind = toolSourceKindFromContributor(contributor);
		}
	}

	toolCallEnded(session: string, turnId: string, toolCallId: string): void {
		this._turnTimings.get(this._key(session, turnId))?.inFlightToolCalls.delete(toolCallId);
	}

	turnBlocked(session: string, turnId: string, requestId: string, kind: SessionInputRequestKind, toolCallId: string | undefined): void {
		const turnKey = this._key(session, turnId);
		const timing = this._turnTimings.get(turnKey);
		if (!timing) {
			return;
		}
		timing.blockers.set(requestId, { kind, toolCallId });
		this._blockerTurnKeys.set(this._key(session, requestId), turnKey);
		this._touch(turnKey, timing);
	}

	turnUnblocked(session: string, requestId: string): void {
		const blockerKey = this._key(session, requestId);
		const turnKey = this._blockerTurnKeys.get(blockerKey);
		if (turnKey === undefined) {
			return;
		}
		this._blockerTurnKeys.delete(blockerKey);
		const timing = this._turnTimings.get(turnKey);
		if (!timing) {
			return;
		}
		timing.blockers.delete(requestId);
		this._touch(turnKey, timing);
	}

	updateModel(session: string, turnId: string, model: string, modelTelemetryKind: AgentHostModelTelemetryKind): void {
		const timing = this._turnTimings.get(this._key(session, turnId));
		if (timing) {
			timing.model = model;
			timing.modelTelemetryKind = modelTelemetryKind;
		}
	}

	updateBilledNanoAiu(session: string, turnId: string, billedNanoAiu: number | undefined): void {
		const usage = this._turnUsages.get(this._key(session, turnId));
		if (usage && typeof billedNanoAiu === 'number' && Number.isFinite(billedNanoAiu) && billedNanoAiu >= 0) {
			usage.billedNanoAiu = billedNanoAiu;
		}
	}

	updateDirectUsage(session: string, turnId: string, tokenTotals: readonly ITurnTokenTotal[] | undefined, billedNanoAiu: number | undefined): void {
		const usage = this._turnUsages.get(this._key(session, turnId));
		if (!usage) {
			return;
		}
		if (tokenTotals) {
			usage.directPromptTokenCount = sumTokenCounts(tokenTotals, total => total.inputTokens);
			usage.directPromptCacheTokenCount = sumTokenCounts(tokenTotals, total => total.cachedTokens);
			usage.directCompletionTokenCount = sumTokenCounts(tokenTotals, total => total.outputTokens);
		}
		if (typeof billedNanoAiu === 'number' && Number.isFinite(billedNanoAiu) && billedNanoAiu >= 0) {
			usage.directBilledNanoAiu = billedNanoAiu;
		}
	}

	modelCallCompleted(session: string, turnId: string, modelCallId: string): void {
		this._turnTimings.get(this._key(session, turnId))?.completedModelCallIds.add(modelCallId);
	}

	getModelTelemetryContext(session: string, turnId: string): { model: string | undefined; modelTelemetryKind: AgentHostModelTelemetryKind | undefined } | undefined {
		const timing = this._turnTimings.get(this._key(session, turnId));
		return timing ? { model: timing.model, modelTelemetryKind: timing.modelTelemetryKind } : undefined;
	}

	getClientTelemetryContext(session: string, turnId: string): IAgentHostClientTelemetryContext | undefined {
		return this._turnTimings.get(this._key(session, turnId))?.clientContext;
	}

	getMessageOriginKind(session: string, turnId: string): AgentHostMessageOriginTelemetryKind | undefined {
		return this._turnTimings.get(this._key(session, turnId))?.messageOriginKind;
	}

	getInitiatorClientId(session: string, turnId: string): string | undefined {
		return this._turnTimings.get(this._key(session, turnId))?.initiatorClientId;
	}

	turnCompleted(session: string, turnId: string, result: AgentHostTurnResult, failure?: IAgentHostTurnFailure, workspace?: { readonly isMultiRoot: boolean; readonly folderCount: number }): boolean {
		const key = this._key(session, turnId);
		const timing = this._turnTimings.get(key);
		if (!timing) {
			return false;
		}
		const usage = this._turnUsages.get(key);
		this._disposeTurn(key, timing);

		this._reporter.turnCompleted({
			clientContext: timing.clientContext,
			provider: timing.agent.id,
			session: timing.session,
			turnId,
			parentTurnId: timing.parentTurnId,
			parentToolCallId: timing.parentToolCallId,
			timeToFirstProgress: timing.firstProgressMs,
			totalTime: timing.stopWatch.elapsed(),
			result,
			model: timing.model,
			modelTelemetryKind: timing.modelTelemetryKind,
			modelSelectionKind: timing.modelSelectionKind,
			permissionLevel: timing.permissionLevel,
			interactionMode: timing.interactionMode,
			messageOriginKind: timing.messageOriginKind,
			subagentTaskModelSource: timing.subagentTaskModelSource,
			failure,
			isMultiRoot: workspace?.isMultiRoot ?? false,
			folderCount: workspace?.folderCount ?? 0,
			billedNanoAiu: usage?.billedNanoAiu,
			directPromptTokenCount: usage?.directPromptTokenCount,
			directPromptCacheTokenCount: usage?.directPromptCacheTokenCount,
			directCompletionTokenCount: usage?.directCompletionTokenCount,
			directBilledNanoAiu: usage?.directBilledNanoAiu,
			modelCallCount: timing.completedModelCallIds.size,
		});

		if (timing.lastHangReason !== undefined) {
			this._reporter.hungTurnCompleted({
				clientContext: timing.clientContext,
				provider: timing.agent.id,
				session: timing.session,
				turnId,
				messageOriginKind: timing.messageOriginKind,
				hangReason: timing.lastHangReason,
				result,
				hangReportCount: timing.hangReportCount,
				totalTimeMs: timing.stopWatch.elapsed(),
				timeAfterHangMs: timing.lastHangStopWatch?.elapsed() ?? 0,
			});
		}
		return true;
	}

	clearSession(session: string): void {
		const prefix = `${session}\0`;
		for (const [key, timing] of this._turnTimings) {
			if (key.startsWith(prefix)) {
				this._disposeTurn(key, timing);
			}
		}
		for (const key of this._blockerTurnKeys.keys()) {
			if (key.startsWith(prefix)) {
				this._blockerTurnKeys.delete(key);
			}
		}
	}

	clearTurnsExcept(session: string, keepTurnIds: ReadonlySet<string>): void {
		const prefix = `${session}\0`;
		for (const [key, timing] of this._turnTimings) {
			if (key.startsWith(prefix) && !keepTurnIds.has(timing.turnId)) {
				this._disposeTurn(key, timing);
			}
		}
	}

	private _disposeTurn(key: string, timing: ITurnTiming): void {
		this._turnTimings.delete(key);
		this._turnUsages.delete(key);
		this._hangWatchdogs.deleteAndDispose(key);
		for (const requestId of timing.blockers.keys()) {
			this._blockerTurnKeys.delete(this._key(timing.session, requestId));
		}
	}

	private _armHangWatchdog(key: string): void {
		this._hangWatchdogs.set(key, disposableTimeout(() => this._onHangWatchdogFired(key), TURN_HANG_THRESHOLD_MS));
	}

	private _onHangWatchdogFired(key: string): void {
		const timing = this._turnTimings.get(key);
		if (!timing) {
			return;
		}
		timing.quietWindows++;

		const hangReason = this._deriveHangReason(timing);
		if (!timing.reportedHangReasons.has(hangReason)) {
			timing.reportedHangReasons.add(hangReason);
			timing.hangReportCount++;
			timing.lastHangReason = hangReason;
			timing.lastHangStopWatch = StopWatch.create(true);
			const userBlocker = this._firstUserBlocker(timing);
			const stuckTool = this._resolveStuckTool(timing, hangReason);
			const providerDiagnostics = this._getProviderDiagnostics(timing);
			this._reporter.turnHung({
				clientContext: timing.clientContext,
				provider: timing.agent.id,
				session: timing.session,
				turnId: timing.turnId,
				messageOriginKind: timing.messageOriginKind,
				hangReason,
				hadAnyProgress: timing.lastActivityKind !== TURN_ACTIVITY_NONE,
				lastActivityKind: timing.lastActivityKind,
				currentStage: timing.currentStage,
				...providerDiagnostics,
				initiatorClientConnectionState: this._getInitiatorClientConnectionState(timing.initiatorClientId),
				blockedOn: userBlocker?.kind,
				toolId: stuckTool?.toolId,
				toolSourceKind: stuckTool?.toolSourceKind,
				inFlightToolCallCount: timing.inFlightToolCalls.size,
				quietTimeMs: timing.quietStopWatch.elapsed(),
				turnElapsedMs: timing.stopWatch.elapsed(),
				model: timing.model,
				modelTelemetryKind: timing.modelTelemetryKind,
				modelSelectionKind: timing.modelSelectionKind,
				permissionLevel: timing.permissionLevel,
			});
		}

		if (timing.quietWindows < MAX_HANG_CHECK_WINDOWS) {
			this._armHangWatchdog(key);
		}
	}

	private _getProviderDiagnostics(timing: ITurnTiming): { providerDiagnosticState: AgentHostProviderDiagnosticState; providerDiagnosticSnapshot: IAgentTurnDiagnosticSnapshot | undefined } {
		const getSnapshot = timing.agent.getTurnDiagnosticSnapshot;
		if (!getSnapshot) {
			return { providerDiagnosticState: 'unsupported', providerDiagnosticSnapshot: undefined };
		}
		try {
			const snapshot = getSnapshot.call(timing.agent, URI.parse(timing.session), timing.turnId);
			return snapshot
				? { providerDiagnosticState: snapshot.state, providerDiagnosticSnapshot: snapshot }
				: { providerDiagnosticState: 'unavailable', providerDiagnosticSnapshot: undefined };
		} catch (error) {
			this._logService.error(`[AgentHostTurnTracker] Failed to collect provider diagnostics for provider=${timing.agent.id}: ${getErrorMessage(error)}`, error);
			return { providerDiagnosticState: 'error', providerDiagnosticSnapshot: undefined };
		}
	}

	private _getInitiatorClientConnectionState(clientId: string | undefined): AgentHostInitiatorClientConnectionState {
		if (!clientId) {
			return 'unknown';
		}
		return this._clientConnections.isClientConnected(clientId) ? 'connected' : 'disconnected';
	}

	private _firstUserBlocker(timing: ITurnTiming): ITurnBlocker | undefined {
		for (const blocker of timing.blockers.values()) {
			if (blocker.kind !== SessionInputRequestKind.ToolClientExecution) {
				return blocker;
			}
		}
		return undefined;
	}

	private _resolveStuckTool(timing: ITurnTiming, hangReason: AgentHostTurnHangReason): IInFlightToolCall | undefined {
		if (hangReason === 'waitingOnUser') {
			const toolCallId = this._firstUserBlocker(timing)?.toolCallId;
			return toolCallId === undefined ? undefined : timing.inFlightToolCalls.get(toolCallId);
		}
		if (hangReason === 'runningTool') {
			return timing.inFlightToolCalls.values().next().value;
		}
		return undefined;
	}

	private _deriveHangReason(timing: ITurnTiming): AgentHostTurnHangReason {
		if (this._firstUserBlocker(timing) !== undefined) {
			return 'waitingOnUser';
		}
		if (timing.inFlightToolCalls.size > 0) {
			return 'runningTool';
		}
		return timing.lastActivityKind === TURN_ACTIVITY_NONE ? 'noProgress' : 'stalledAfterProgress';
	}

	private _key(session: string, turnId: string): string {
		return `${session}\0${turnId}`;
	}
}

function sumTokenCounts(totals: readonly ITurnTokenTotal[], getCount: (total: ITurnTokenTotal) => number): number {
	return totals.reduce((sum, total) => {
		const count = getCount(total);
		return sum + (Number.isFinite(count) && count >= 0 ? count : 0);
	}, 0);
}
