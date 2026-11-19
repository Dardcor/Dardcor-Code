/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';
import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isClaudeAccountSetUp, resolveClaudeTransportMode } from '../../node/claude/claudeTransportMode.js';

suite('claudeTransportMode', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('resolveClaudeTransportMode uses native credentials only when explicitly enabled', () => {
		const bools: readonly boolean[] = [false, true];

		const actual: Record<string, string> = {};
		for (const allowSignedOutWhenUsable of bools) {
			for (const hasExistingSetup of bools) {
				const key = `flag=${allowSignedOutWhenUsable},setup=${hasExistingSetup}`;
				actual[key] = resolveClaudeTransportMode({ allowSignedOutWhenUsable, hasExistingSetup });
			}
		}

		assert.deepStrictEqual(actual, {
			'flag=false,setup=false': 'proxy',
			'flag=false,setup=true': 'proxy',
			'flag=true,setup=false': 'proxy',
			'flag=true,setup=true': 'native',
		});
	});

	suite('isClaudeAccountSetUp', () => {
		const cases: readonly (readonly [name: string, account: AccountInfo | undefined, expected: boolean])[] = [
			['no report at all', undefined, false],
			['nothing configured', { tokenSource: 'none', apiProvider: 'firstParty' }, false],
			['nothing configured, no provider field', { tokenSource: 'none' }, false],
			['empty report', {}, false],
			['oauth token', { tokenSource: 'ANTHROPIC_AUTH_TOKEN', apiProvider: 'firstParty' }, true],
			['api key', { tokenSource: 'none', apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' }, true],
			['third-party backend (bedrock)', { apiProvider: 'bedrock' }, true],
			['third-party backend (vertex)', { apiProvider: 'vertex' }, true],
			['enterprise gateway', { apiProvider: 'gateway' }, true],
		];

		test('maps observed SDK account reports onto one set-up answer', () => {
			assert.deepStrictEqual(
				Object.fromEntries(cases.map(([name, account]) => [name, isClaudeAccountSetUp(account)])),
				Object.fromEntries(cases.map(([name, , expected]) => [name, expected])));
		});
	});
});
