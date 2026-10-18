/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getCopilotConfigSlashCommandItems, isCopilotConfigSlashCommand, resolveCopilotConfigSlashCommandOnSend } from '../../common/copilotConfigSlashCommands.js';

suite('copilotConfigSlashCommands', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('getCopilotConfigSlashCommandItems', () => {
		test('empty prefix returns permission and mode items with labels and actions', () => {
			const items = getCopilotConfigSlashCommandItems('');
			const byLabel = new Map(items.map(i => [i.label, i]));

			assert.strictEqual(byLabel.get('/yolo on')?.insertText, '');
			assert.deepStrictEqual(byLabel.get('/yolo on')?.applyConfig, { autoApprove: 'autoApprove' });
			assert.deepStrictEqual(byLabel.get('/yolo off')?.applyConfig, { autoApprove: 'default' });

			assert.strictEqual(byLabel.get('/autopilot on')?.insertText, '');
			assert.deepStrictEqual(byLabel.get('/autopilot on')?.applyConfig, { mode: 'autopilot' });
			assert.deepStrictEqual(byLabel.get('/autopilot off')?.applyConfig, { mode: 'interactive' });
			const prompt = byLabel.get('/autopilot');
			assert.strictEqual(prompt?.insertText, '/autopilot ');
			assert.deepStrictEqual(prompt?.applyConfig, { mode: 'autopilot' });
			assert.strictEqual(prompt?.argumentHint, 'objective');
		});

		test('prefix filters by command name', () => {
			const commands = new Set(getCopilotConfigSlashCommandItems('autop').map(i => i.command));
			assert.deepStrictEqual([...commands], ['autopilot']);
			assert.strictEqual(getCopilotConfigSlashCommandItems('nope').length, 0);
		});

		test('fuzzy filters by command name', () => {
			const commands = new Set(getCopilotConfigSlashCommandItems('pt').map(i => i.command));
			assert.deepStrictEqual([...commands], ['autopilot']);
		});

		test('autopilot state hides the no-op toggle but keeps the prompt form', () => {
			const inAutopilot = new Set(getCopilotConfigSlashCommandItems('autopilot', { mode: 'autopilot' }).map(i => i.label));
			assert.deepStrictEqual([...inAutopilot].sort(), ['/autopilot', '/autopilot off']);

			const notAutopilot = new Set(getCopilotConfigSlashCommandItems('autopilot', { mode: 'interactive' }).map(i => i.label));
			assert.deepStrictEqual([...notAutopilot].sort(), ['/autopilot', '/autopilot on']);

			const inPlan = new Set(getCopilotConfigSlashCommandItems('autopilot', { mode: 'plan' }).map(i => i.label));
			assert.deepStrictEqual([...inPlan].sort(), ['/autopilot', '/autopilot on']);
		});

		test('autoApprove state hides the no-op bypass/default toggles across aliases', () => {
			const bypassing = new Set(getCopilotConfigSlashCommandItems('yolo', { autoApprove: 'autoApprove' }).map(i => i.label));
			assert.deepStrictEqual([...bypassing].sort(), ['/yolo off']);

			const notBypassing = new Set(getCopilotConfigSlashCommandItems('allow-all', { autoApprove: 'default' }).map(i => i.label));
			assert.deepStrictEqual([...notBypassing].sort(), ['/allow-all on']);
		});
	});

	suite('resolveCopilotConfigSlashCommandOnSend', () => {
		test('maps commands, sub-args, and strips the token', () => {
			assert.deepStrictEqual(resolveCopilotConfigSlashCommandOnSend('yolo', ''), { applyConfig: { autoApprove: 'autoApprove' }, strippedPrompt: '' });
			assert.deepStrictEqual(resolveCopilotConfigSlashCommandOnSend('autopilot', 'off'), { applyConfig: { mode: 'interactive' }, strippedPrompt: '' });
			assert.deepStrictEqual(resolveCopilotConfigSlashCommandOnSend('autopilot', 'do the thing'), { applyConfig: { mode: 'autopilot' }, strippedPrompt: 'do the thing' });
			assert.deepStrictEqual(resolveCopilotConfigSlashCommandOnSend('plan', 'the feature'), { applyConfig: { mode: 'plan' }, strippedPrompt: 'the feature' });
			assert.strictEqual(resolveCopilotConfigSlashCommandOnSend('yolo', 'onxxxcva'), undefined);
			assert.strictEqual(resolveCopilotConfigSlashCommandOnSend('allow-all', 'offxxxcva'), undefined);
			assert.strictEqual(resolveCopilotConfigSlashCommandOnSend('notACommand', 'x'), undefined);
		});
	});

	test('isCopilotConfigSlashCommand recognizes config commands only', () => {
		assert.strictEqual(isCopilotConfigSlashCommand('autopilot'), true);
		assert.strictEqual(isCopilotConfigSlashCommand('YOLO'), true);
		assert.strictEqual(isCopilotConfigSlashCommand('rubber-duck'), false);
	});
});
