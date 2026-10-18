/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Terminal, SettingsEditor } from '../../../../automation';
import { setTerminalTestSettings } from './terminal-helpers';

export function setup(options?: { skipSuite: boolean }) {
	(options?.skipSuite ? describe.skip : describe)('Terminal Input', () => {
		let terminal: Terminal;
		let settingsEditor: SettingsEditor;

		before(async function () {
			const app = this.app as Application;
			terminal = app.workbench.terminal;
			settingsEditor = app.workbench.settingsEditor;
			await setTerminalTestSettings(app);
		});

		after(async function () {
			await settingsEditor.clearUserSettings();
		});

		describe('Auto replies', function () {

			if (process.platform === 'win32') {
				this.retries(3);
			}

			async function writeTextForAutoReply(text: string): Promise<void> {
				await terminal.runCommandInTerminal(`"\r${text}`, true);
			}

			it('should automatically reply to a custom entry', async () => {
				await settingsEditor.addUserSetting('terminal.integrated.autoReplies', '{ "foo": "bar" }');
				await terminal.createTerminal();
				await writeTextForAutoReply('foo');
				await terminal.waitForTerminalText(buffer => buffer.some(line => line.match(/foo.*bar/)));
			});
		});
	});
}
