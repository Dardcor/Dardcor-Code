/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Logger, Quality } from '../../../../automation';
import { installAllHandlers } from '../../utils';

export function setup(logger: Logger, opts: { web?: boolean }, quality: Quality) {
	describe('Accessibility', function () {

		this.timeout(2 * 60 * 1000);

		this.retries(2);

		installAllHandlers(logger);

		let app: Application;

		before(async function () {
			app = this.app as Application;
		});

		describe('Workbench', function () {

			(opts.web ? it.skip : it)('workbench has no accessibility violations', async function () {
				await app.code.waitForElement('.monaco-workbench');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.monaco-workbench',
					excludeRules: {
						'link-in-text-block': ['command:workbench.action.chat.generateAgentInstructions'],
						'aria-allowed-attr': ['monaco-list', 'monaco-list-row'],
						'aria-required-children': ['monaco-list']
					}
				});
			});

			it('activity bar has no accessibility violations', async function () {
				await app.code.waitForElement('.activitybar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.activitybar'
				});
			});

			it('sidebar has no accessibility violations', async function () {
				await app.code.waitForElement('.sidebar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.sidebar'
				});
			});

			it('status bar has no accessibility violations', async function () {
				await app.code.waitForElement('.statusbar');

				await app.code.driver.assertNoAccessibilityViolations({
					selector: '.statusbar'
				});
			});
		});

		if (!opts.web) {
			describe('Chat', function () {

				it('chat panel has no accessibility violations', async function () {
					await app.workbench.quickaccess.runCommand('workbench.action.chat.open');

					await app.code.waitForElement('div[id="workbench.panel.chat"]');

					await app.code.driver.assertNoAccessibilityViolations({
						selector: 'div[id="workbench.panel.chat"]',
						excludeRules: {
							'link-in-text-block': ['command:workbench.action.chat.generateAgentInstructions'],
							'aria-allowed-attr': ['monaco-list', 'monaco-list-row'],
						}
					});
				});

				it('chat response has no accessibility violations', async function () {
					this.retries(0);
					this.timeout(3 * 60 * 1000);

					await app.workbench.settingsEditor.addUserSetting('chat.allowAnonymousAccess', 'true');

					await app.workbench.quickaccess.runCommand('workbench.action.chat.open');

					await app.workbench.chat.waitForChatView();

					await app.workbench.chat.sendMessage('Explain what "Hello World" means in programming. Include a short fenced code block that shows "Hello World".');

					try {
						await app.workbench.chat.waitForResponse(1500);
					} catch {
						this.skip();
					}

					await app.code.driver.assertNoAccessibilityViolations({
						selector: 'div[id="workbench.panel.chat"]',
						excludeRules: {
							'link-in-text-block': ['command:workbench.action.chat.generateAgentInstructions'],
							'aria-allowed-attr': ['monaco-list', 'monaco-list-row'],
							'aria-command-name': ['codicon-plus'],
							'nested-interactive': ['todo-list-container']
						}
					});
				});

				it.skip('chat terminal tool response has no accessibility violations', async function () {
					this.retries(0);
					this.timeout(3 * 60 * 1000);

					await app.workbench.settingsEditor.addUserSetting('chat.allowAnonymousAccess', 'true');
					await app.workbench.settingsEditor.addUserSetting('chat.tools.global.autoApprove', 'true');

					await app.workbench.quickaccess.runCommand('workbench.action.chat.open');

					await app.workbench.chat.waitForChatView();

					await app.workbench.chat.sendMessage('Run ls in the terminal');

					try {
						await app.workbench.chat.waitForResponse(1500);
					} catch {
						this.skip();
					}

					await app.code.driver.assertNoAccessibilityViolations({
						selector: 'div[id="workbench.panel.chat"]',
						excludeRules: {
							'link-in-text-block': ['command:workbench.action.chat.generateAgentInstructions'],
							'aria-allowed-attr': ['monaco-list', 'monaco-list-row'],
							'aria-command-name': ['codicon-plus'],
							'nested-interactive': ['todo-list-container']
						}
					});
				});
			});
		}
	});
}
