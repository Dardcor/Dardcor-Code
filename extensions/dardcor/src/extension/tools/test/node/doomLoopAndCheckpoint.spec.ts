/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import { DoomLoopDetector } from '../../../agent/doomLoopDetector';
import { GitCheckpointEngine } from '../../../checkpoint/gitCheckpoint';

describe('Doom Loop Detector & Checkpoint Engine', () => {
	let detector: DoomLoopDetector;

	beforeEach(() => {
		detector = DoomLoopDetector.getInstance();
		detector.reset();
	});

	it('should allow distinct tool calls without triggering doom loop', () => {
		const res1 = detector.recordAndCheck('replaceString', { file: 'a.ts', old: 'x', new: 'y' });
		const res2 = detector.recordAndCheck('replaceString', { file: 'b.ts', old: 'x', new: 'z' });
		const res3 = detector.recordAndCheck('replaceString', { file: 'c.ts', old: 'a', new: 'b' });

		assert.strictEqual(res1.isDoomLoop, false);
		assert.strictEqual(res2.isDoomLoop, false);
		assert.strictEqual(res3.isDoomLoop, false);
	});

	it('should trigger doom loop when the same tool call with identical input repeats 3 times', () => {
		const input = { file: 'error.ts', old: 'broken', new: 'fixed' };
		const res1 = detector.recordAndCheck('replaceString', input);
		const res2 = detector.recordAndCheck('replaceString', input);
		const res3 = detector.recordAndCheck('replaceString', input);

		assert.strictEqual(res1.isDoomLoop, false);
		assert.strictEqual(res2.isDoomLoop, false);
		assert.strictEqual(res3.isDoomLoop, true);
		assert.ok(res3.message?.includes('Doom loop detected'));
	});

	it('GitCheckpointEngine should capture and manage checkpoint records', async () => {
		const engine = new GitCheckpointEngine(process.cwd());
		const cp = await engine.capture('Test checkpoint');

		assert.ok(cp.id.startsWith('cp_'));
		assert.strictEqual(typeof cp.timestamp, 'number');
		assert.strictEqual(cp.description, 'Test checkpoint');

		const list = engine.list();
		assert.ok(list.length > 0);
		assert.strictEqual(list[0].id, cp.id);
	});
});
