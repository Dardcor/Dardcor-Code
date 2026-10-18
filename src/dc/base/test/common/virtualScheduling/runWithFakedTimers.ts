/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../common/cancellation.js';
import { drainMicrotasksEmbedding } from './embedding.js';
import { pushGlobalTimeApi } from './globalTimeApi.js';
import { realTimeApi } from './timeApi.js';
import { untilToken, VirtualTimeProcessor } from './processor.js';
import { createRecordingRealTimeApi, RecordedTimerEvent } from './recordingTimeApi.js';
import { VirtualClock } from './virtualClock.js';
import { createVirtualTimeApi } from './virtualTimeApi.js';

export interface RunWithFakedTimersOptions {
	readonly startTime?: number;
	readonly useFakeTimers?: boolean;
	readonly useSetImmediate?: boolean;
	readonly maxTaskCount?: number;
	readonly onHistory?: (history: readonly RecordedTimerEvent[]) => void;
}

/**
 * Run `fn` with a virtual clock installed as the global time API.
 *
 * After `fn` resolves, the virtual queue is drained (so any timers `fn`
 * scheduled and `await`ed for, transitively, complete deterministically).
 * If `fn` throws, the queue is *not* drained — the original error is
 * re-thrown immediately.
 */
export async function runWithFakedTimers<T>(
	options: RunWithFakedTimersOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const useFakeTimers = options.useFakeTimers !== false;
	if (!useFakeTimers) {
		if (!options.onHistory) { return fn(); }
		const history: RecordedTimerEvent[] = [];
		const restore = pushGlobalTimeApi(createRecordingRealTimeApi(history));
		try {
			return await fn();
		} finally {
			restore.dispose();
			options.onHistory(history);
		}
	}

	const clock = new VirtualClock(options.startTime ?? 0);
	const virtualApi = createVirtualTimeApi(clock);
	const restoreGlobals = pushGlobalTimeApi(virtualApi);

	const processor = new VirtualTimeProcessor(
		clock,
		drainMicrotasksEmbedding(realTimeApi),
		realTimeApi,
		{ defaultMaxEvents: options.maxTaskCount ?? 100 },
	);

	const cts = new CancellationTokenSource();
	const runPromise = processor.run({ until: untilToken(cts.token) });

	let didThrow = true;
	let result: T;
	try {
		result = await fn();
		didThrow = false;
	} finally {
		restoreGlobals.dispose();
		cts.cancel();

		try {
			if (!didThrow) {
				await runPromise;
			} else {
				runPromise.catch(() => { });
			}
		} finally {
			cts.dispose();
			options.onHistory?.(processor.history);
			processor.dispose();
		}
	}

	return result;
}
