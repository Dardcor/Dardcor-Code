/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { BackgroundSummarizationState, BackgroundSummarizationThresholds, BackgroundSummarizer, IBackgroundSummarizationResult, resolveSummaryAnchorRoundId, shouldKickOffBackgroundSummarization } from '../backgroundSummarizer';

describe('BackgroundSummarizer', () => {

	test('initial state is Idle', () => {
		const summarizer = new BackgroundSummarizer(100_000);
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
		expect(summarizer.error).toBeUndefined();
		expect(summarizer.token).toBeUndefined();
	});

	test('start transitions to InProgress', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => {
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		expect(summarizer.state).toBe(BackgroundSummarizationState.InProgress);
		expect(summarizer.token).toBeDefined();
		await summarizer.waitForCompletion();
	});

	test('successful work transitions to Completed', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		const result: IBackgroundSummarizationResult = { summary: 'test summary', toolCallRoundId: 'round1' };
		summarizer.start(async _token => result);
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Completed);
	});

	test('failed work transitions to Failed', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => {
			throw new Error('summarization failed');
		});
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Failed);
		expect(summarizer.error).toBeInstanceOf(Error);
	});

	test('consumeAndReset returns result and resets to Idle', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		const expected: IBackgroundSummarizationResult = { summary: 'test summary', toolCallRoundId: 'round1' };
		summarizer.start(async _token => expected);
		await summarizer.waitForCompletion();

		const result = summarizer.consumeAndReset();
		expect(result).toEqual(expected);
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
		expect(summarizer.token).toBeUndefined();
	});

	test('consumeAndReset returns undefined while InProgress', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });
		summarizer.start(async _token => {
			await gate;
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		expect(summarizer.consumeAndReset()).toBeUndefined();
		expect(summarizer.state).toBe(BackgroundSummarizationState.InProgress);
		summarizer.cancel();
		resolveFn!();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
	});

	test('consumeAndReset returns undefined after failure', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => {
			throw new Error('fail');
		});
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Failed);

		const result = summarizer.consumeAndReset();
		expect(result).toBeUndefined();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
	});

	test('start is a no-op when already InProgress', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let callCount = 0;
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });
		summarizer.start(async _token => {
			callCount++;
			await gate;
			return { summary: 'first', toolCallRoundId: 'r1' };
		});
		summarizer.start(async _token => {
			callCount++;
			return { summary: 'second', toolCallRoundId: 'r2' };
		});
		resolveFn!();
		await summarizer.waitForCompletion();
		expect(callCount).toBe(1);
		expect(summarizer.consumeAndReset()?.summary).toBe('first');
	});

	test('start is a no-op when already Completed', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => ({ summary: 'first', toolCallRoundId: 'r1' }));
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Completed);

		summarizer.start(async _token => ({ summary: 'second', toolCallRoundId: 'r2' }));
		expect(summarizer.state).toBe(BackgroundSummarizationState.Completed);
		expect(summarizer.consumeAndReset()?.summary).toBe('first');
	});

	test('start retries after Failed state', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => {
			throw new Error('fail');
		});
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Failed);

		summarizer.start(async _token => ({ summary: 'retry', toolCallRoundId: 'r2' }));
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Completed);
		expect(summarizer.consumeAndReset()?.summary).toBe('retry');
	});

	test('cancel resets state to Idle', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });
		summarizer.start(async _token => {
			await gate;
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		expect(summarizer.state).toBe(BackgroundSummarizationState.InProgress);

		summarizer.cancel();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
		expect(summarizer.token).toBeUndefined();
		expect(summarizer.error).toBeUndefined();
		resolveFn!();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
	});

	test('cancel prevents .then() from setting state to Completed', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });

		summarizer.start(async _token => {
			await gate;
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		expect(summarizer.state).toBe(BackgroundSummarizationState.InProgress);

		summarizer.cancel();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);

		resolveFn!();
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
	});

	test('cancel prevents .catch() from setting state to Failed', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let rejectFn: (err: Error) => void;
		const gate = new Promise<void>((_, reject) => { rejectFn = reject; });

		summarizer.start(async _token => {
			await gate;
			return { summary: 'unreachable', toolCallRoundId: 'r1' };
		});

		summarizer.cancel();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);

		rejectFn!(new Error('fail'));
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
		expect(summarizer.error).toBeUndefined();
	});

	test('waitForCompletion is a no-op when nothing started', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
	});

	test('multiple waitForCompletion calls resolve correctly', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });
		summarizer.start(async _token => {
			await gate;
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		resolveFn!();
		await Promise.all([
			summarizer.waitForCompletion(),
			summarizer.waitForCompletion(),
		]);
		expect(summarizer.state).toBe(BackgroundSummarizationState.Completed);
	});

	test('waitForCompletion resolves without error even when work fails', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		summarizer.start(async _token => {
			throw new Error('network timeout');
		});
		await summarizer.waitForCompletion();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Failed);
	});

	test('cancel during waitForCompletion leaves state Idle with no result', async () => {
		const summarizer = new BackgroundSummarizer(100_000);
		let resolveFn: () => void;
		const gate = new Promise<void>(resolve => { resolveFn = resolve; });
		summarizer.start(async _token => {
			await gate;
			return { summary: 'test', toolCallRoundId: 'r1' };
		});
		const completionPromise = summarizer.waitForCompletion();
		summarizer.cancel();
		resolveFn!();
		await completionPromise;
		await new Promise<void>(resolve => setTimeout(resolve, 0));

		const result = summarizer.consumeAndReset();
		expect(result).toBeUndefined();
		expect(summarizer.state).toBe(BackgroundSummarizationState.Idle);
	});
});

const { warmJitterMin, warmJitterSpan, emergency } = BackgroundSummarizationThresholds;

const midRng = () => 0.5;
const maxRng = () => 1 - Number.EPSILON;
const unusedRng = () => {
	throw new Error('rng should not be consumed');
};

describe('shouldKickOffBackgroundSummarization', () => {
	describe('cold cache', () => {
		test('defers kick-off below the emergency threshold', () => {
			expect(shouldKickOffBackgroundSummarization(0.85, false, unusedRng)).toBe(false);
		});

		test('kicks off at the emergency threshold', () => {
			expect(shouldKickOffBackgroundSummarization(emergency, false, unusedRng)).toBe(true);
			expect(shouldKickOffBackgroundSummarization(0.91, false, unusedRng)).toBe(true);
		});

		test('does not consume the rng on the cold branch', () => {
			expect(() => shouldKickOffBackgroundSummarization(0.85, false, unusedRng)).not.toThrow();
			expect(() => shouldKickOffBackgroundSummarization(0.91, false, unusedRng)).not.toThrow();
		});
	});

	describe('warm cache', () => {
		test('kicks off at the jittered midpoint (0.80) when ratio meets it', () => {
			expect(shouldKickOffBackgroundSummarization(0.80, true, midRng)).toBe(true);
			expect(shouldKickOffBackgroundSummarization(0.81, true, midRng)).toBe(true);
		});

		test('defers when ratio is under the jittered threshold', () => {
			expect(shouldKickOffBackgroundSummarization(0.77, true, midRng)).toBe(false);
			expect(shouldKickOffBackgroundSummarization(warmJitterMin - 0.0001, true, () => 0)).toBe(false);
		});

		test('respects the top of the jitter range', () => {
			expect(shouldKickOffBackgroundSummarization(0.81, true, maxRng)).toBe(false);
			expect(shouldKickOffBackgroundSummarization(warmJitterMin + warmJitterSpan, true, maxRng)).toBe(true);
		});
	});
});

describe('resolveSummaryAnchorRoundId', () => {
	const round = (id: string) => ({ id });
	const turn = (...ids: string[]) => ({ rounds: ids.map(round) });

	test('returns undefined with no current rounds and no history', () => {
		expect(resolveSummaryAnchorRoundId([], [])).toBeUndefined();
	});

	test('returns undefined when there are no current rounds and every history turn is empty', () => {
		expect(resolveSummaryAnchorRoundId([], [turn(), turn()])).toBeUndefined();
	});

	test('anchors to the only current-turn round', () => {
		expect(resolveSummaryAnchorRoundId([round('r1')], [])).toBe('r1');
	});

	test('anchors to the round before the last so the most recent round is preserved verbatim', () => {
		expect(resolveSummaryAnchorRoundId([round('r1'), round('r2'), round('r3')], [])).toBe('r2');
	});

	test('falls back to the most recent history round when the current turn has none', () => {
		expect(resolveSummaryAnchorRoundId([], [turn('a1', 'a2'), turn('b1', 'b2')])).toBe('b2');
	});

	test('skips trailing empty history turns when falling back', () => {
		expect(resolveSummaryAnchorRoundId([], [turn('a1'), turn('b1', 'b2'), turn()])).toBe('b2');
	});

	test('prefers current-turn rounds over history', () => {
		expect(resolveSummaryAnchorRoundId([round('c1')], [turn('h1', 'h2')])).toBe('c1');
	});
});
