/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { autorun, observableValue, throttledObservable } from '../../../common/observable.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../utils.js';
import { runWithFakedTimers } from '../timeTravelScheduler.js';

suite('throttledObservable', () => {
	const ds = ensureNoDisposablesAreLeakedInTestSuite();

	test('emits initial value immediately without delay', () => runWithFakedTimers({}, async () => {
		const log: string[] = [];
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 100);

		ds.add(autorun(reader => {
			log.push(`t=0: ${throttled.read(reader)}`);
		}));

		assert.deepStrictEqual(log, ['t=0: 0']);
	}));

	test('delays first change by throttleMs', () => runWithFakedTimers({}, async () => {
		const log: string[] = [];
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 100);

		ds.add(autorun(reader => {
			log.push(`value: ${throttled.read(reader)}`);
		}));
		log.length = 0;

		source.set(1, undefined);

		assert.deepStrictEqual(log, []);

		await new Promise<void>(r => setTimeout(r, 100));

		assert.deepStrictEqual(log, ['value: 1']);
	}));

	test('does not reset timer on subsequent changes (no starvation)', () => runWithFakedTimers({}, async () => {
		const log: string[] = [];
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 100);

		ds.add(autorun(reader => {
			log.push(`value: ${throttled.read(reader)}`);
		}));
		log.length = 0;

		source.set(1, undefined);
		await new Promise<void>(r => setTimeout(r, 50));
		source.set(2, undefined);
		await new Promise<void>(r => setTimeout(r, 30));
		source.set(3, undefined);

		assert.deepStrictEqual(log, []);

		await new Promise<void>(r => setTimeout(r, 30));

		assert.deepStrictEqual(log, ['value: 3']);
	}));

	test('emits again after previous throttle window completes', () => runWithFakedTimers({}, async () => {
		const log: string[] = [];
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 100);

		ds.add(autorun(reader => {
			log.push(`value: ${throttled.read(reader)}`);
		}));
		log.length = 0;

		source.set(1, undefined);
		await new Promise<void>(r => setTimeout(r, 100));
		assert.deepStrictEqual(log, ['value: 1']);
		log.length = 0;

		source.set(2, undefined);
		assert.deepStrictEqual(log, []);

		await new Promise<void>(r => setTimeout(r, 100));
		assert.deepStrictEqual(log, ['value: 2']);
	}));

	test('records correct timing sequence', () => runWithFakedTimers({}, async () => {
		const timings: { time: number; value: number }[] = [];
		const startTime = Date.now();
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 200);

		ds.add(autorun(reader => {
			const v = throttled.read(reader);
			timings.push({ time: Date.now() - startTime, value: v });
		}));

		await new Promise<void>(r => setTimeout(r, 50));
		source.set(1, undefined);

		await new Promise<void>(r => setTimeout(r, 50));
		source.set(2, undefined);

		await new Promise<void>(r => setTimeout(r, 160));

		await new Promise<void>(r => setTimeout(r, 40));
		source.set(3, undefined);

		await new Promise<void>(r => setTimeout(r, 200));

		assert.deepStrictEqual(timings, [
			{ time: 0, value: 0 },
			{ time: 250, value: 2 },
			{ time: 500, value: 3 },
		]);
	}));

	test('cleanup on dispose stops pending timer', () => runWithFakedTimers({}, async () => {
		const log: string[] = [];
		const source = observableValue('source', 0);
		const throttled = throttledObservable(source, 100);

		const d = ds.add(autorun(reader => {
			log.push(`value: ${throttled.read(reader)}`);
		}));
		log.length = 0;

		source.set(1, undefined);
		d.dispose();

		await new Promise<void>(r => setTimeout(r, 150));

		assert.deepStrictEqual(log, []);
	}));
});
