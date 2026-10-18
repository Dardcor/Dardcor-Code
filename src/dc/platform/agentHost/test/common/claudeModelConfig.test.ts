/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { CLAUDE_THINKING_LEVEL_KEY, toRuntimeEffortLevel, createClaudeThinkingLevelSchema, isClaudeEffortLevel, resolveClaudeEffort, type ClaudeEffortLevel } from '../../common/claudeModelConfig.js';
import type { ModelSelection } from '../../common/state/protocol/state.js';

suite('resolveClaudeEffort (Phase 6.1 / Cycle E)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('returns the SDK enum value for each accepted thinkingLevel string', () => {
		const accepted = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
		const actual = accepted.map(level => resolveClaudeEffort({
			id: 'claude-opus-4.6',
			config: { [CLAUDE_THINKING_LEVEL_KEY]: level },
		}));
		assert.deepStrictEqual(actual, ['low', 'medium', 'high', 'xhigh', 'max']);
	});

	test('returns undefined for absent / unrecognized inputs (SDK default takes over)', () => {
		const cases: readonly (ModelSelection | undefined)[] = [
			undefined,
			{ id: 'claude-opus-4.6' },
			{ id: 'claude-opus-4.6', config: {} },
			{ id: 'claude-opus-4.6', config: { unrelated: 'high' } },
			{ id: 'claude-opus-4.6', config: { [CLAUDE_THINKING_LEVEL_KEY]: 'turbo' } },
		];
		assert.deepStrictEqual(cases.map(resolveClaudeEffort), [undefined, undefined, undefined, undefined, undefined]);
	});
});

suite('toRuntimeEffortLevel', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('passes every level through unchanged — including `max` — and preserves undefined', () => {
		const inputs: readonly (ClaudeEffortLevel | undefined)[] = [undefined, 'low', 'medium', 'high', 'xhigh', 'max'];
		assert.deepStrictEqual(
			inputs.map(toRuntimeEffortLevel),
			[undefined, 'low', 'medium', 'high', 'xhigh', 'max'],
		);
	});
});

suite('isClaudeEffortLevel (Phase 6.1 / Cycle D3)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('accepts the canonical 5-value union, rejects anything else', () => {
		const inputs = ['low', 'medium', 'high', 'xhigh', 'max', '', 'LOW', 'turbo', 'minimal', 'High'];
		assert.deepStrictEqual(inputs.map(isClaudeEffortLevel), [true, true, true, true, true, false, false, false, false, false]);
	});
});

suite('createClaudeThinkingLevelSchema (Phase 6.1 / Cycle D3)', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('per-model variation: enum + enumLabels + default track the supplied list; empty list returns undefined', () => {
		const fullUnion: readonly ClaudeEffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
		const lowMediumHigh: readonly ClaudeEffortLevel[] = ['low', 'medium', 'high'];
		const highOnly: readonly ClaudeEffortLevel[] = ['high'];
		const noHigh: readonly ClaudeEffortLevel[] = ['max', 'low'];
		const empty: readonly ClaudeEffortLevel[] = [];

		assert.deepStrictEqual({
			fullUnion: createClaudeThinkingLevelSchema(fullUnion),
			lowMediumHigh: createClaudeThinkingLevelSchema(lowMediumHigh),
			highOnly: createClaudeThinkingLevelSchema(highOnly),
			noHigh: createClaudeThinkingLevelSchema(noHigh),
			empty: createClaudeThinkingLevelSchema(empty),
		}, {
			fullUnion: {
				type: 'object',
				properties: {
					thinkingLevel: {
						type: 'string',
						title: 'Thinking Level',
						description: 'Controls how much reasoning effort Claude uses.',
						enum: ['low', 'medium', 'high', 'xhigh', 'max'],
						enumLabels: ['Low', 'Medium', 'High', 'Extra High', 'Max'],
						enumDescriptions: ['Faster responses with less reasoning', 'Balanced reasoning and speed', 'Greater reasoning depth but slower', 'Highest reasoning depth but slowest', 'Absolute maximum capability with no constraints'],
						default: 'high',
					},
				},
			},
			lowMediumHigh: {
				type: 'object',
				properties: {
					thinkingLevel: {
						type: 'string',
						title: 'Thinking Level',
						description: 'Controls how much reasoning effort Claude uses.',
						enum: ['low', 'medium', 'high'],
						enumLabels: ['Low', 'Medium', 'High'],
						enumDescriptions: ['Faster responses with less reasoning', 'Balanced reasoning and speed', 'Greater reasoning depth but slower'],
						default: 'high',
					},
				},
			},
			highOnly: {
				type: 'object',
				properties: {
					thinkingLevel: {
						type: 'string',
						title: 'Thinking Level',
						description: 'Controls how much reasoning effort Claude uses.',
						enum: ['high'],
						enumLabels: ['High'],
						enumDescriptions: ['Greater reasoning depth but slower'],
						default: 'high',
					},
				},
			},
			noHigh: {
				type: 'object',
				properties: {
					thinkingLevel: {
						type: 'string',
						title: 'Thinking Level',
						description: 'Controls how much reasoning effort Claude uses.',
						enum: ['max', 'low'],
						enumLabels: ['Max', 'Low'],
						enumDescriptions: ['Absolute maximum capability with no constraints', 'Faster responses with less reasoning'],
					},
				},
			},
			empty: undefined,
		});
	});

	test(`emits default: 'high' iff 'high' is in the supported list, never substitutes another value`, () => {
		const cases: readonly { input: readonly ClaudeEffortLevel[]; expected: ClaudeEffortLevel | undefined }[] = [
			{ input: ['high'], expected: 'high' },
			{ input: ['low', 'high'], expected: 'high' },
			{ input: ['low', 'medium', 'high', 'xhigh', 'max'], expected: 'high' },
			{ input: ['low'], expected: undefined },
			{ input: ['low', 'medium'], expected: undefined },
			{ input: ['xhigh'], expected: undefined },
			{ input: ['xhigh', 'max'], expected: undefined },
		];
		assert.deepStrictEqual(
			cases.map(c => createClaudeThinkingLevelSchema(c.input)?.properties.thinkingLevel.default),
			cases.map(c => c.expected),
		);
	});

	test('input array is not mutated and the returned enum is independent of subsequent input mutation', () => {
		const input: ClaudeEffortLevel[] = ['low', 'high'];
		const schema = createClaudeThinkingLevelSchema(input);
		input.push('max');
		assert.deepStrictEqual({
			input,
			enum: schema?.properties.thinkingLevel.enum,
			default: schema?.properties.thinkingLevel.default,
		}, {
			input: ['low', 'high', 'max'],
			enum: ['low', 'high'],
			default: 'high',
		});
	});
});

