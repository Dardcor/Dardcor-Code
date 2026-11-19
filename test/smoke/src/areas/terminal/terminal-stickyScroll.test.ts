/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Terminal, SettingsEditor, TerminalCommandIdWithValue } from '../../../../automation';
import { setTerminalTestSettings } from './terminal-helpers';

export function setup(options?: { skipSuite: boolean }) {
	(options?.skipSuite ? describe.skip : describe)('Terminal stickyScroll', () => {
		let app: Application;
		let terminal: Terminal;
		let settingsEditor: SettingsEditor;
		before(async function () {
			app = this.app as Application;
			terminal = app.workbench.terminal;
			settingsEditor = app.workbench.settingsEditor;
			await setTerminalTestSettings(app, [
				['terminal.integrated.stickyScroll.enabled', 'true']
			]);
		});

		after(async function () {
			await settingsEditor.clearUserSettings();
		});

		async function checkCommandAndOutput(
			command: string,
			exitCode: number,
			prompt: string = 'Prompt> ',
			expectedLineCount: number = 1
		): Promise<void> {
			const data = generateCommandAndOutput(prompt, command, exitCode);
			await terminal.runCommandWithValue(TerminalCommandIdWithValue.WriteDataToTerminal, data);
			await app.code.waitForElements('.terminal-sticky-scroll .xterm-rows > *', true, e => e.length === expectedLineCount);
			const element = await app.code.getElement('.terminal-sticky-scroll .xterm-rows');
			if (
				element &&
				element.textContent.indexOf(`${prompt.replace(/\\r\\n/g, '')}${command}`) >= 0
			) {
				return;
			}
			throw new Error(`Failed for command ${command}, exitcode ${exitCode}, text content ${element?.textContent}`);
		}

		async function beforeEachSetup() {
			await terminal.createEmptyTerminal();
		}

		it('should show sticky scroll when appropriate', async () => {
			await beforeEachSetup();

			await checkCommandAndOutput('sticky scroll 1', 0);

			await checkCommandAndOutput('sticky scroll 2', 1);
		});

		it('should support multi-line prompt', async () => {
			await beforeEachSetup();

			await checkCommandAndOutput('sticky scroll 1', 0, 'Multi-line\\r\\nPrompt> ', 2);

			await checkCommandAndOutput('sticky scroll 2', 0, '\\r\\nMulti-line Prompt> ', 1);

			await checkCommandAndOutput('sticky scroll 3', 0, '\\r\\nMulti-line\\r\\nPrompt> ', 2);
		});
	});
}

function generateCommandAndOutput(prompt: string, command: string, exitCode: number): string {
	return [
		`${vsc('A')}${prompt}${vsc('B')}${command}`,
		`\\r\\n${vsc('C')}`,
		`\\r\\ndata`.repeat(50),
		`\\r\\n${vsc(`D;${exitCode}`)}`,
	].join('');
}

function vsc(data: string) {
	return setTextParams(`633;${data}`);
}

function setTextParams(data: string) {
	return osc(`${data}\\x07`);
}

function osc(data: string) {
	return `\\x1b]${data}`;
}
