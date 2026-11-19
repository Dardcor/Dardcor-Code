/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, test } from 'vitest';
import { ConfigKey, ExperimentBasedConfig, ExperimentBasedConfigType } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { AggressivenessLevel, AggressivenessSetting, DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION, UserHappinessScoreConfiguration } from '../../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { ILogService } from '../../../../platform/log/common/logService';
import { IExperimentationService, NullExperimentationService } from '../../../../platform/telemetry/common/nullExperimentationService';
import { NullTelemetryService } from '../../../../platform/telemetry/common/nullTelemetryService';
import { ITelemetryService, TelemetryEventMeasurements, TelemetryEventProperties } from '../../../../platform/telemetry/common/telemetry';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { ActionKind, MAX_INTERACTIONS_CONSIDERED, MAX_INTERACTIONS_STORED, UserInteractionMonitor } from '../../common/userInteractionMonitor';


class TestUserInteractionMonitor extends UserInteractionMonitor {
	getActionsForAggressiveness(): { time: number; kind: ActionKind }[] {
		return [...this._recentUserActionsForAggressiveness];
	}

	getActionsForTiming(): { time: number; kind: ActionKind.Accepted | ActionKind.Rejected }[] {
		return [...this._recentUserActionsForTiming];
	}

	getUserHappinessScoreConfiguration(): UserHappinessScoreConfiguration {
		return this._getUserHappinessScoreConfiguration();
	}
}

class MockConfigurationService extends InMemoryConfigurationService {
	private _useAdaptiveAggressiveness = false;

	constructor() {
		super(new DefaultsOnlyConfigurationService());
	}

	useAdaptiveAggressiveness(): void {
		this._useAdaptiveAggressiveness = true;
	}

	override getExperimentBasedConfig<T extends ExperimentBasedConfigType>(key: ExperimentBasedConfig<T>, experimentationService: IExperimentationService): T {
		if (this._useAdaptiveAggressiveness && key === ConfigKey.TeamInternal.InlineEditsXtabAggressivenessLevel) {
			return undefined as T;
		}
		return super.getExperimentBasedConfig(key, experimentationService);
	}
}

interface TelemetryCall {
	eventName: string;
	properties?: TelemetryEventProperties;
	measurements?: TelemetryEventMeasurements;
}

class MockTelemetryService extends NullTelemetryService {
	readonly msftEvents: TelemetryCall[] = [];

	override sendMSFTTelemetryEvent(eventName: string, properties?: TelemetryEventProperties, measurements?: TelemetryEventMeasurements): void {
		this.msftEvents.push({ eventName, properties, measurements });
	}

	reset(): void {
		this.msftEvents.length = 0;
	}
}

describe('UserInteractionMonitor', () => {
	let configurationService: MockConfigurationService;
	let experimentationService: IExperimentationService;
	let logService: ILogService;
	let telemetryService: ITelemetryService;
	let monitor: TestUserInteractionMonitor;

	beforeEach(() => {
		configurationService = new MockConfigurationService();
		experimentationService = new NullExperimentationService();
		logService = new TestLogService();
		telemetryService = new NullTelemetryService();
		monitor = new TestUserInteractionMonitor(configurationService, experimentationService, logService, telemetryService);
	});

	describe('history logging', () => {
		test('handleAcceptance logs accepted action to both histories', () => {
			monitor.handleAcceptance();

			const aggressivenessActions = monitor.getActionsForAggressiveness();
			const timingActions = monitor.getActionsForTiming();

			expect(aggressivenessActions).toHaveLength(1);
			expect(aggressivenessActions[0].kind).toBe(ActionKind.Accepted);

			expect(timingActions).toHaveLength(1);
			expect(timingActions[0].kind).toBe(ActionKind.Accepted);
		});

		test('handleRejection logs rejected action to both histories', () => {
			monitor.handleRejection();

			const aggressivenessActions = monitor.getActionsForAggressiveness();
			const timingActions = monitor.getActionsForTiming();

			expect(aggressivenessActions).toHaveLength(1);
			expect(aggressivenessActions[0].kind).toBe(ActionKind.Rejected);

			expect(timingActions).toHaveLength(1);
			expect(timingActions[0].kind).toBe(ActionKind.Rejected);
		});

		test('handleIgnored logs only to aggressiveness history, not timing', () => {
			monitor.handleIgnored();

			const aggressivenessActions = monitor.getActionsForAggressiveness();
			const timingActions = monitor.getActionsForTiming();

			expect(aggressivenessActions).toHaveLength(1);
			expect(aggressivenessActions[0].kind).toBe(ActionKind.Ignored);

			expect(timingActions).toHaveLength(0);
		});

		test('actions are recorded with timestamps', () => {
			const beforeTime = Date.now();
			monitor.handleAcceptance();
			const afterTime = Date.now();

			const actions = monitor.getActionsForAggressiveness();
			expect(actions[0].time).toBeGreaterThanOrEqual(beforeTime);
			expect(actions[0].time).toBeLessThanOrEqual(afterTime);
		});

		test('multiple actions are recorded in order', () => {
			monitor.handleAcceptance();
			monitor.handleRejection();
			monitor.handleIgnored();
			monitor.handleAcceptance();

			const aggressivenessActions = monitor.getActionsForAggressiveness();
			expect(aggressivenessActions).toHaveLength(4);
			expect(aggressivenessActions[0].kind).toBe(ActionKind.Accepted);
			expect(aggressivenessActions[1].kind).toBe(ActionKind.Rejected);
			expect(aggressivenessActions[2].kind).toBe(ActionKind.Ignored);
			expect(aggressivenessActions[3].kind).toBe(ActionKind.Accepted);

			const timingActions = monitor.getActionsForTiming();
			expect(timingActions).toHaveLength(3);
			expect(timingActions[0].kind).toBe(ActionKind.Accepted);
			expect(timingActions[1].kind).toBe(ActionKind.Rejected);
			expect(timingActions[2].kind).toBe(ActionKind.Accepted);
		});

		test('aggressiveness history is limited to MAX_INTERACTIONS_STORED', () => {
			for (let i = 0; i < MAX_INTERACTIONS_STORED + 5; i++) {
				monitor.handleAcceptance();
			}

			const actions = monitor.getActionsForAggressiveness();
			expect(actions).toHaveLength(MAX_INTERACTIONS_STORED);
		});

		test('timing history is limited to MAX_INTERACTIONS_CONSIDERED', () => {
			for (let i = 0; i < MAX_INTERACTIONS_CONSIDERED + 5; i++) {
				monitor.handleAcceptance();
			}

			const actions = monitor.getActionsForTiming();
			expect(actions).toHaveLength(MAX_INTERACTIONS_CONSIDERED);
		});

		test('timing history does not include "ignored" events', () => {

			monitor.handleIgnored();
			monitor.handleIgnored();
			monitor.handleIgnored();

			expect(monitor.getActionsForTiming()).toHaveLength(0);

			expect(monitor.getActionsForAggressiveness()).toHaveLength(3);
		});
	});

	describe('aggressiveness level calculation', () => {
		test('defaults to medium aggressiveness without using adaptive scoring', () => {
			expect(monitor.getAggressivenessLevel()).toEqual({
				aggressivenessLevel: AggressivenessLevel.Medium,
				userHappinessScore: undefined,
			});
		});

		test('explicit user eagerness takes priority over configured aggressiveness', () => {
			configurationService.setConfig(ConfigKey.Advanced.InlineEditsAggressiveness, AggressivenessSetting.High);
			configurationService.setConfig(ConfigKey.TeamInternal.InlineEditsXtabAggressivenessLevel, AggressivenessLevel.Low);

			expect(monitor.getAggressivenessLevel()).toEqual({
				aggressivenessLevel: AggressivenessLevel.High,
				userHappinessScore: undefined,
			});
		});

		test('returns high aggressiveness after many acceptances', () => {
			configurationService.useAdaptiveAggressiveness();
			for (let i = 0; i < 10; i++) {
				monitor.handleAcceptance();
			}

			const level = monitor.getAggressivenessLevel().aggressivenessLevel;
			expect(level).toBe(AggressivenessLevel.High);
		});

		test('returns low aggressiveness after many rejections', () => {
			configurationService.useAdaptiveAggressiveness();
			for (let i = 0; i < 10; i++) {
				monitor.handleRejection();
			}

			const level = monitor.getAggressivenessLevel().aggressivenessLevel;
			expect(level).toBe(AggressivenessLevel.Low);
		});

		test('respects configured aggressiveness level override', () => {
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsXtabAggressivenessLevel,
				AggressivenessLevel.Low
			);

			for (let i = 0; i < 10; i++) {
				monitor.handleAcceptance();
			}

			const level = monitor.getAggressivenessLevel().aggressivenessLevel;
			expect(level).toBe(AggressivenessLevel.Low);
		});

		test('recent actions have more weight than older ones', () => {
			configurationService.useAdaptiveAggressiveness();
			for (let i = 0; i < 5; i++) {
				monitor.handleAcceptance();
			}
			for (let i = 0; i < 5; i++) {
				monitor.handleRejection();
			}

			const levelRejectionsRecent = monitor.getAggressivenessLevel().aggressivenessLevel;

			monitor = new TestUserInteractionMonitor(configurationService, experimentationService, logService, telemetryService);
			for (let i = 0; i < 5; i++) {
				monitor.handleRejection();
			}
			for (let i = 0; i < 5; i++) {
				monitor.handleAcceptance();
			}

			const levelAcceptancesRecent = monitor.getAggressivenessLevel().aggressivenessLevel;

			const aggressivenessOrder = [AggressivenessLevel.Low, AggressivenessLevel.Medium, AggressivenessLevel.High];
			expect(aggressivenessOrder.indexOf(levelAcceptancesRecent)).toBeGreaterThanOrEqual(
				aggressivenessOrder.indexOf(levelRejectionsRecent)
			);
		});
	});

	describe('ignored action limiting', () => {
		test('ignored actions are included in aggressiveness calculation', () => {
			configurationService.useAdaptiveAggressiveness();
			const customConfig: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				includeIgnored: true,
				limitTotalIgnored: false,
				limitConsecutiveIgnored: false,
			};
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				JSON.stringify(customConfig)
			);

			monitor.handleAcceptance();
			monitor.handleIgnored();
			monitor.handleIgnored();
			monitor.handleRejection();

			const level = monitor.getAggressivenessLevel().aggressivenessLevel;
			expect(level).toBe(AggressivenessLevel.Medium);
		});

		test('total ignored limit is respected', () => {
			configurationService.useAdaptiveAggressiveness();
			const customConfig: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				includeIgnored: true,
				limitTotalIgnored: true,
				limitConsecutiveIgnored: false,
				ignoredLimit: 2,
			};
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				JSON.stringify(customConfig)
			);

			monitor.handleIgnored();
			monitor.handleAcceptance();
			monitor.handleIgnored();
			monitor.handleAcceptance();
			monitor.handleIgnored();
			monitor.handleIgnored();
			monitor.handleIgnored();

			const level = monitor.getAggressivenessLevel().aggressivenessLevel;
			expect([AggressivenessLevel.Medium, AggressivenessLevel.High]).toContain(level);
		});
	});

	describe('config parse error telemetry', () => {
		let mockTelemetryService: MockTelemetryService;

		beforeEach(() => {
			configurationService.useAdaptiveAggressiveness();
			mockTelemetryService = new MockTelemetryService();
			monitor = new TestUserInteractionMonitor(configurationService, experimentationService, logService, mockTelemetryService);
		});

		test('emits telemetry event when config is invalid JSON', () => {
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				'not valid json'
			);

			monitor.getAggressivenessLevel();

			expect(mockTelemetryService.msftEvents).toHaveLength(1);
			expect(mockTelemetryService.msftEvents[0].eventName).toBe('incorrectNesAdaptiveAggressivenessConfig');
			expect(mockTelemetryService.msftEvents[0].properties).toMatchObject({
				configName: ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString.id,
				configValue: 'not valid json',
			});
			expect(mockTelemetryService.msftEvents[0].properties?.errorMessage).toBeDefined();
		});

		test('emits telemetry event when config has missing required fields', () => {
			const incompleteConfig = JSON.stringify({
				acceptedScore: 1,
				rejectedScore: 0,
			});
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				incompleteConfig
			);

			monitor.getAggressivenessLevel();

			expect(mockTelemetryService.msftEvents).toHaveLength(1);
			expect(mockTelemetryService.msftEvents[0].eventName).toBe('incorrectNesAdaptiveAggressivenessConfig');
			expect(mockTelemetryService.msftEvents[0].properties?.configValue).toBe(incompleteConfig);
		});

		test('emits telemetry event when config has invalid score relationships', () => {
			const invalidConfig = JSON.stringify({
				acceptedScore: 0.3,
				rejectedScore: 0.7,
				ignoredScore: 0.5,
				highThreshold: 0.7,
				mediumThreshold: 0.4,
				includeIgnored: false,
				ignoredLimit: 0,
				limitConsecutiveIgnored: false,
				limitTotalIgnored: true,
			});
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				invalidConfig
			);

			monitor.getAggressivenessLevel();

			expect(mockTelemetryService.msftEvents).toHaveLength(1);
			expect(mockTelemetryService.msftEvents[0].eventName).toBe('incorrectNesAdaptiveAggressivenessConfig');
			expect(mockTelemetryService.msftEvents[0].properties?.errorMessage).toContain('acceptedScore must be greater than rejectedScore');
		});

		test('returns default config when parse fails', () => {
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				'invalid'
			);

			const parsedConfig = monitor.getUserHappinessScoreConfiguration();

			expect(parsedConfig).toEqual(DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION);
		});

		test('does not emit telemetry for valid config', () => {
			const validConfig: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				acceptedScore: 0.9,
				rejectedScore: 0.1,
			};
			configurationService.setConfig(
				ConfigKey.TeamInternal.InlineEditsUserHappinessScoreConfigurationString,
				JSON.stringify(validConfig)
			);

			const parsedConfig = monitor.getUserHappinessScoreConfiguration();

			expect(parsedConfig).toEqual(validConfig);
			expect(parsedConfig).not.toEqual(DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION);

			expect(mockTelemetryService.msftEvents).toHaveLength(0);
		});
	});
});
