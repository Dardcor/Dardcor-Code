/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { AggressivenessLevel, AggressivenessSetting, DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION, parseUserHappinessScoreConfigurationString, UserHappinessScoreConfiguration } from '../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { ILogService } from '../../../platform/log/common/logService';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { ErrorUtils } from '../../../util/common/errors';
import { DelaySession } from './delay';

export enum ActionKind {
	Accepted = 'accepted',
	Rejected = 'rejected',
	Ignored = 'ignored',
}

export interface NESUserAction {
	time: number;
	kind: ActionKind;
}

export const MAX_INTERACTIONS_CONSIDERED = 10;
export const MAX_INTERACTIONS_STORED = 30;

export function getWindowWithIgnoredLimit(
	actions: NESUserAction[],
	config: UserHappinessScoreConfiguration
): NESUserAction[] {
	const { limitConsecutiveIgnored, limitTotalIgnored, ignoredLimit } = config;

	if (!limitConsecutiveIgnored && !limitTotalIgnored) {
		return actions.slice(-MAX_INTERACTIONS_CONSIDERED);
	}

	const result: NESUserAction[] = [];
	let consecutiveIgnored = 0;
	let totalIgnored = 0;

	for (let i = actions.length - 1; i >= 0 && result.length < MAX_INTERACTIONS_CONSIDERED; i--) {
		const action = actions[i];

		if (action.kind === ActionKind.Ignored) {
			let skip = false;
			if (limitConsecutiveIgnored && consecutiveIgnored >= ignoredLimit) {
				skip = true;
			}
			if (limitTotalIgnored && totalIgnored >= ignoredLimit) {
				skip = true;
			}

			if (skip) {
				continue;
			}

			consecutiveIgnored++;
			totalIgnored++;
		} else {
			consecutiveIgnored = 0;
		}

		result.push(action);
	}

	result.reverse();
	return result;
}

export function getUserHappinessScore(
	actions: NESUserAction[],
	config: UserHappinessScoreConfiguration
): number {
	if (actions.length === 0) {
		return 0.5;
	}

	const window = getWindowWithIgnoredLimit(actions, config);

	if (window.length === 0) {
		return 0.5;
	}

	let weightedScore = 0;
	let totalWeight = 0;
	let scoredActionCount = 0;

	for (let i = 0; i < window.length; i++) {
		const action = window[i];

		if (action.kind === ActionKind.Ignored && !config.includeIgnored) {
			continue;
		}

		scoredActionCount++;

		const weight = i + 1;

		let score: number;
		switch (action.kind) {
			case ActionKind.Accepted:
				score = config.acceptedScore;
				break;
			case ActionKind.Rejected:
				score = config.rejectedScore;
				break;
			case ActionKind.Ignored:
				score = config.ignoredScore;
				break;
		}

		const normalized = (score - config.rejectedScore) / (config.acceptedScore - config.rejectedScore);

		weightedScore += normalized * weight;
		totalWeight += weight;
	}

	const rawScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

	const dataConfidence = scoredActionCount / MAX_INTERACTIONS_CONSIDERED;
	return 0.5 + (rawScore - 0.5) * dataConfidence;
}

export class UserInteractionMonitor {

	protected _recentUserActionsForAggressiveness: NESUserAction[] = [];

	protected _recentUserActionsForTiming: (NESUserAction & { kind: ActionKind.Accepted | ActionKind.Rejected })[] = [];

	private _lastActionWasAcceptance = false;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExperimentationService private readonly _experimentationService: IExperimentationService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
	) { }


	public handleAcceptance(): void {
		this._recordUserAction(ActionKind.Accepted);
	}

	public handleRejection(): void {
		this._recordUserAction(ActionKind.Rejected);
	}

	public handleIgnored(): void {
		this._recordUserAction(ActionKind.Ignored);
	}

	get wasLastActionAcceptance(): boolean {
		return this._lastActionWasAcceptance;
	}

	private _recordUserAction(kind: ActionKind): void {
		const now = Date.now();

		this._lastActionWasAcceptance = kind === ActionKind.Accepted;

		this._recentUserActionsForAggressiveness.push({ time: now, kind });
		this._recentUserActionsForAggressiveness = this._recentUserActionsForAggressiveness.slice(-MAX_INTERACTIONS_STORED);

		if (kind !== ActionKind.Ignored) {
			this._recentUserActionsForTiming.push({ time: now, kind });
			this._recentUserActionsForTiming = this._recentUserActionsForTiming.slice(-MAX_INTERACTIONS_CONSIDERED);
		}
	}


	public createDelaySession(requestTime: number | undefined): DelaySession {
		const baseDebounceTime = this._configurationService.getExperimentBasedConfig(ConfigKey.TeamInternal.InlineEditsDebounce, this._experimentationService);

		const backoffDebounceEnabled = this._configurationService.getExperimentBasedConfig(ConfigKey.TeamInternal.InlineEditsBackoffDebounceEnabled, this._experimentationService);
		const expectedTotalTime = backoffDebounceEnabled ? this._getExpectedTotalTime(baseDebounceTime) : undefined;

		return new DelaySession(baseDebounceTime, expectedTotalTime, requestTime);
	}

	private _getExpectedTotalTime(baseDebounceTime: number): number {
		const DEBOUNCE_DECAY_TIME_MS = 10 * 60 * 1000;
		const MAX_DEBOUNCE_TIME = 3000;
		const MIN_DEBOUNCE_TIME = 50;
		const REJECTION_WEIGHT = 1.5;
		const ACCEPTANCE_WEIGHT = 0.8;
		const now = Date.now();
		let multiplier = 1;

		for (const action of this._recentUserActionsForTiming) {
			const timeSinceAction = now - action.time;
			if (timeSinceAction > DEBOUNCE_DECAY_TIME_MS) {
				continue;
			}

			const decayFactor = Math.exp(-timeSinceAction / DEBOUNCE_DECAY_TIME_MS);
			const actionWeight = action.kind === ActionKind.Rejected ? REJECTION_WEIGHT : ACCEPTANCE_WEIGHT;
			multiplier *= 1 + ((actionWeight - 1) * decayFactor);
		}

		let debounceTime = baseDebounceTime * multiplier;

		debounceTime = Math.min(MAX_DEBOUNCE_TIME, Math.max(MIN_DEBOUNCE_TIME, debounceTime));

		return debounceTime;
	}


	public getAggressivenessLevel(): { aggressivenessLevel: AggressivenessLevel; userHappinessScore: number | undefined } {
		const userAggressiveness = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.InlineEditsAggressiveness, this._experimentationService);
		const userLevel = AggressivenessSetting.toLevel(userAggressiveness);
		if (userLevel !== undefined) {
			return { aggressivenessLevel: userLevel, userHappinessScore: undefined };
		}

		const configuredAggressivenessLevel = this._configurationService.getExperimentBasedConfig(ConfigKey.TeamInternal.InlineEditsXtabAggressivenessLevel, this._experimentationService);

		if (configuredAggressivenessLevel !== undefined) {
			return { aggressivenessLevel: configuredAggressivenessLevel, userHappinessScore: undefined };
		}

		let level: AggressivenessLevel;
		const config = this._getUserHappinessScoreConfiguration();
		const userHappinessScore = this._getUserHappinessScore(config);
		if (userHappinessScore >= config.highThreshold) {
			level = AggressivenessLevel.High;
		} else if (userHappinessScore >= config.mediumThreshold) {
			level = AggressivenessLevel.Medium;
		} else {
			level = AggressivenessLevel.Low;
		}
		return { aggressivenessLevel: level, userHappinessScore };
	}

	protected _getUserHappinessScoreConfiguration(): UserHappinessScoreConfiguration {
		const configKey = ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString;
		const configString = this._configurationService.getExperimentBasedConfig(configKey, this._experimentationService);
		if (configString === undefined) {
			return DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION;
		}

		try {
			return parseUserHappinessScoreConfigurationString(configString);
		}
		catch (e) {
			this._logService.error(e, 'Failed to parse user happiness score configuration, using default config');
			this._telemetryService.sendMSFTTelemetryEvent('incorrectNesAdaptiveAggressivenessConfig', { configName: configKey.id, errorMessage: ErrorUtils.toString(ErrorUtils.fromUnknown(e)), configValue: configString });
			return DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION;
		}
	}

	private _getUserHappinessScore(config: UserHappinessScoreConfiguration): number {
		return getUserHappinessScore(this._recentUserActionsForAggressiveness, config);
	}
}
