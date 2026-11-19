/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION, parseUserHappinessScoreConfigurationString, UserHappinessScoreConfiguration } from '../../../../platform/inlineEdits/common/dataTypes/xtabPromptOptions';
import { ActionKind, getUserHappinessScore, getWindowWithIgnoredLimit, MAX_INTERACTIONS_CONSIDERED, NESUserAction } from '../../common/userInteractionMonitor';

function action(kind: ActionKind): NESUserAction {
	return { time: 0, kind };
}

function v1GetUserHappinessScore(actions: NESUserAction[]): number {
	if (actions.length === 0) {
		return 0.5;
	}

	let weightedScore = 0;
	let totalWeight = 0;

	for (let i = 0; i < actions.length; i++) {
		const a = actions[i];
		const weight = i + 1;

		const score = a.kind === ActionKind.Accepted ? 1 : 0;

		weightedScore += score * weight;
		totalWeight += weight;
	}

	const rawScore = totalWeight > 0 ? weightedScore / totalWeight : 0.5;

	const dataConfidence = actions.length / MAX_INTERACTIONS_CONSIDERED;
	return 0.5 + (rawScore - 0.5) * dataConfidence;
}

const CONFIG_MIMICS_V1: UserHappinessScoreConfiguration = {
	acceptedScore: 1,
	rejectedScore: 0,
	ignoredScore: 0.5,
	highThreshold: 0.7,
	mediumThreshold: 0.4,
	includeIgnored: false,
	ignoredLimit: 0,
	limitConsecutiveIgnored: false,
	limitTotalIgnored: true,
};

describe('UserHappinessScore', () => {

	const accepted = ActionKind.Accepted;
	const rejected = ActionKind.Rejected;
	const ignored = ActionKind.Ignored;

	describe('v2 algorithm mimics v1', () => {
		const testCases: { name: string; actions: ActionKind[] }[] = [
			{ name: 'empty actions', actions: [] },
			{ name: 'single accept', actions: [accepted] },
			{ name: 'single reject', actions: [rejected] },
			{ name: 'all accepts', actions: [accepted, accepted, accepted, accepted, accepted] },
			{ name: 'all rejects', actions: [rejected, rejected, rejected, rejected, rejected] },
			{ name: 'mixed 50/50', actions: [accepted, rejected, accepted, rejected, accepted, rejected] },
			{ name: 'accepts then rejects', actions: [accepted, accepted, accepted, rejected, rejected, rejected] },
			{ name: 'rejects then accepts', actions: [rejected, rejected, rejected, accepted, accepted, accepted] },
			{ name: 'full 10 mixed', actions: [accepted, rejected, accepted, accepted, rejected, accepted, rejected, accepted, rejected, accepted] },
			{ name: 'accepts with ignored', actions: [accepted, ignored, accepted, ignored, accepted] },
			{ name: 'rejects with ignored', actions: [rejected, ignored, rejected, ignored, rejected] },
			{ name: 'mixed with many ignored', actions: [accepted, ignored, ignored, ignored, rejected, ignored, accepted] },
			{ name: 'all ignored', actions: [ignored, ignored, ignored, ignored, ignored] },
			{ name: 'accept surrounded by ignored', actions: [ignored, ignored, accepted, ignored, ignored] },
		];

		for (const testCase of testCases) {
			test(testCase.name, () => {
				const v1Actions = testCase.actions
					.filter((a): a is ActionKind.Accepted | ActionKind.Rejected => a !== ActionKind.Ignored)
					.map(kind => action(kind));

				const newActions = testCase.actions.map(kind => action(kind));

				const v1Score = v1GetUserHappinessScore(v1Actions);
				const newScore = getUserHappinessScore(newActions, CONFIG_MIMICS_V1);

				expect(newScore).toBeCloseTo(v1Score, 6);
			});
		}
	});

	describe('v2 algorithm with ignored actions', () => {
		test('ignored actions count towards score when includeIgnored is true', () => {
			const config: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				includeIgnored: true,
			};

			const actions = [
				action(accepted),
				action(ignored),
				action(rejected),
			];

			const score = getUserHappinessScore(actions, config);
			expect(score).toBeGreaterThan(0.4);
			expect(score).toBeLessThan(0.6);
		});

		test('consecutive ignored limiting works correctly', () => {
			const config: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				limitConsecutiveIgnored: true,
				limitTotalIgnored: false,
				ignoredLimit: 2,
				includeIgnored: true,
			};

			const actions: NESUserAction[] = [
				action(ignored),
				action(ignored),
				action(ignored),
				action(ignored),
				action(ignored),
				action(accepted),
			];

			const window = getWindowWithIgnoredLimit(actions, config);
			expect(window.length).toBe(3);
		});

		test('total ignored limiting works correctly', () => {
			const config: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				limitConsecutiveIgnored: false,
				limitTotalIgnored: true,
				ignoredLimit: 2,
				includeIgnored: true,
			};

			const actions: NESUserAction[] = [
				action(ignored),
				action(accepted),
				action(ignored),
				action(rejected),
				action(ignored),
				action(accepted),
			];

			const window = getWindowWithIgnoredLimit(actions, config);
			const ignoredCount = window.filter(a => a.kind === ignored).length;
			expect(ignoredCount).toBe(2);
		});

		test('different score weights affect result', () => {
			const actions = [
				action(accepted),
				action(ignored),
				action(rejected),
			];

			const configWithIgnoredNeutral: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				includeIgnored: true,
				ignoredScore: 0.5,
				limitTotalIgnored: false,
			};

			const configWithIgnoredPositive: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				includeIgnored: true,
				ignoredScore: 0.8,
				limitTotalIgnored: false,
			};

			const neutralScore = getUserHappinessScore(actions, configWithIgnoredNeutral);
			const positiveScore = getUserHappinessScore(actions, configWithIgnoredPositive);

			expect(positiveScore).toBeGreaterThan(neutralScore);
		});
	});

	describe('edge cases', () => {
		test('empty actions returns neutral score', () => {
			const score = getUserHappinessScore([], DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION);
			expect(score).toBe(0.5);
		});

		test('all ignored with no limiting returns neutral', () => {
			const config: UserHappinessScoreConfiguration = {
				...DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION,
				limitTotalIgnored: true,
				ignoredLimit: 0,
				includeIgnored: false,
			};

			const actions = [
				action(ignored),
				action(ignored),
				action(ignored),
			];

			const score = getUserHappinessScore(actions, config);
			expect(score).toBe(0.5);
		});

		test('score adjusts towards neutral with fewer data points', () => {
			const config = DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION;

			const singleAccept = getUserHappinessScore([action(accepted)], config);
			expect(singleAccept).toBeGreaterThan(0.5);
			expect(singleAccept).toBeLessThan(0.6);

			const manyAccepts = getUserHappinessScore(
				Array(10).fill(null).map(() => action(accepted)),
				config
			);
			expect(manyAccepts).toBeGreaterThan(0.9);
		});

		test('more recent actions have higher weight', () => {
			const config = DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION;

			const acceptsThenRejects = getUserHappinessScore(
				[action(accepted), action(accepted), action(rejected), action(rejected)],
				config
			);

			const rejectsThenAccepts = getUserHappinessScore(
				[action(rejected), action(rejected), action(accepted), action(accepted)],
				config
			);

			expect(rejectsThenAccepts).toBeGreaterThan(acceptsThenRejects);
		});
	});

	describe('configuration parsing', () => {
		test('stringified default configuration parses correctly', () => {
			const stringified = JSON.stringify(DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION);
			const parsed = parseUserHappinessScoreConfigurationString(stringified);

			expect(parsed).toEqual(DEFAULT_USER_HAPPINESS_SCORE_CONFIGURATION);
		});

		test('custom configuration string parses correctly', () => {
			const configString = '{"acceptedScore": 1.0, "rejectedScore": 0.2, "ignoredScore": 0.5, "highThreshold": 0.6, "mediumThreshold": 0.4, "includeIgnored": true, "ignoredLimit": 5, "limitConsecutiveIgnored": false, "limitTotalIgnored": true}';
			const parsed = parseUserHappinessScoreConfigurationString(configString);

			expect(parsed).toEqual({
				acceptedScore: 1.0,
				rejectedScore: 0.2,
				ignoredScore: 0.5,
				highThreshold: 0.6,
				mediumThreshold: 0.4,
				includeIgnored: true,
				ignoredLimit: 5,
				limitConsecutiveIgnored: false,
				limitTotalIgnored: true,
			});
		});

		test('parsed configuration can be used for score calculation', () => {
			const configString = '{"acceptedScore": 1.0, "rejectedScore": 0.2, "ignoredScore": 0.5, "highThreshold": 0.6, "mediumThreshold": 0.4, "includeIgnored": true, "ignoredLimit": 5, "limitConsecutiveIgnored": false, "limitTotalIgnored": true}';
			const config = parseUserHappinessScoreConfigurationString(configString);

			const actions = [
				action(accepted),
				action(ignored),
				action(rejected),
			];

			const score = getUserHappinessScore(actions, config);
			expect(typeof score).toBe('number');
			expect(score).toBeGreaterThanOrEqual(0);
			expect(score).toBeLessThanOrEqual(1);
		});
	});
});
