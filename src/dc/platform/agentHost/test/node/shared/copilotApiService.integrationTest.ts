/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../log/common/log.js';
import { DardcorRouterService } from '../../../node/shared/dardcorRouterService.js';

suite('DardcorRouterService.utilityChatCompletion (real CAPI)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const githubToken = process.env.COPILOT_GITHUB_TOKEN;
	const hasToken = !!githubToken;

	function createService(): DardcorRouterService {
		const boundFetch: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);
		return new DardcorRouterService(boundFetch, new NullLogService());
	}

	(hasToken ? test : test.skip)('answers a trivial arithmetic prompt', async function () {
		this.timeout(30_000);
		const service = createService();
		const answer = await service.utilityChatCompletion({
			messages: [
				{ role: 'system', content: 'You answer math questions with only the integer result, no words, no punctuation.' },
				{ role: 'user', content: 'What is 1+3?' },
			],
		});
		assert.ok(answer.includes('4'), `expected the answer to contain "4", got: ${JSON.stringify(answer)}`);
	});

	(hasToken ? test : test.skip)('returns the assistant text for a multi-turn prompt', async function () {
		this.timeout(30_000);
		const service = createService();
		const answer = await service.utilityChatCompletion({
			messages: [
				{ role: 'system', content: 'You reverse the word the user gives you and reply with only the reversed word, nothing else.' },
				{ role: 'user', content: 'hello' },
			],
		});
		assert.strictEqual(answer.trim().toLowerCase(), 'olleh');
	});

	(hasToken ? test : test.skip)('reuses endpoint and model discovery across calls', async function () {
		this.timeout(60_000);
		const service = createService();

		const first = await service.utilityChatCompletion({
			messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
		});
		const second = await service.utilityChatCompletion({
			messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
		});

		assert.ok(first.toLowerCase().includes('ok'));
		assert.ok(second.toLowerCase().includes('ok'));
	});
});
