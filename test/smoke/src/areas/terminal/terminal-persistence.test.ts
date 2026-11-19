/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Terminal, TerminalCommandId, TerminalCommandIdWithValue, SettingsEditor } from '../../../../automation';
import { setTerminalTestSettings } from './terminal-helpers';

export function setup(options?: { skipSuite: boolean }) {
	(options?.skipSuite ? describe.skip : describe)('Terminal Persistence', () => {
		let terminal: Terminal;
		let settingsEditor: SettingsEditor;

		before(async function () {
			const app = this.app as Application;
			terminal = app.workbench.terminal;
			settingsEditor = app.workbench.settingsEditor;
			await setTerminalTestSettings(app, [
				['terminal.integrated.tabs.title', '"${process}"']
			]);
		});

		after(async function () {
			await settingsEditor.clearUserSettings();
		});

		describe('detach/attach', () => {
			it('should support basic reconnection', async () => {
				await terminal.createTerminal();
				await terminal.assertTerminalGroups([
					[{ name: '.*' }]
				]);

				await terminal.assertTerminalGroups([
					[{ name: '.*' }]
				]);
				const name = (await terminal.getTerminalGroups())[0][0].name!;

				await terminal.runCommand(TerminalCommandId.DetachSession);
				await terminal.assertTerminalViewHidden();

				await terminal.runCommandWithValue(TerminalCommandIdWithValue.AttachToSession, name);
				await terminal.assertTerminalGroups([
					[{ name }]
				]);
			});

			it.skip('should persist buffer content', async () => {
				await terminal.createTerminal();
				await terminal.assertTerminalGroups([
					[{ name: '.*' }]
				]);

				await terminal.assertTerminalGroups([
					[{ name: '.*' }]
				]);
				const name = (await terminal.getTerminalGroups())[0][0].name!;

				await terminal.runCommandInTerminal('echo terminal_test_content');
				await terminal.waitForTerminalText(buffer => buffer.some(e => e.includes('terminal_test_content')));

				await terminal.runCommand(TerminalCommandId.DetachSession);
				await terminal.assertTerminalViewHidden();

				await terminal.runCommandWithValue(TerminalCommandIdWithValue.AttachToSession, name);
				await terminal.assertTerminalGroups([
					[{ name }]
				]);
				await terminal.waitForTerminalText(buffer => buffer.some(e => e.replaceAll(/[\r\n]/g, '').includes('terminal_test_content')));
			});
		});
	});
}
