/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { expandShellToolName, normalizeShellToolNameForCapture } from './e2e/harness/shellToolNames.js';

suite('capiReplayProxy shell tool names', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('captures store platform-neutral placeholders', () => {
		assert.deepStrictEqual([
			'bash', 'powershell',
			'read_bash', 'read_powershell',
			'write_bash', 'write_powershell',
			'stop_bash', 'stop_powershell',
			'list_bash', 'list_powershell',
			'bash_shutdown', 'powershell_shutdown',
		].map(normalizeShellToolNameForCapture), [
			'${shell}', '${shell}',
			'${read_shell}', '${read_shell}',
			'${write_shell}', '${write_shell}',
			'${stop_shell}', '${stop_shell}',
			'${list_shell}', '${list_shell}',
			'${shell_shutdown}', '${shell_shutdown}',
		]);
	});

	test('replay expands placeholders to the running platform', () => {
		const placeholders = ['${shell}', '${read_shell}', '${write_shell}', '${stop_shell}', '${list_shell}', '${shell_shutdown}'];
		assert.deepStrictEqual({
			win32: placeholders.map(name => expandShellToolName(name, 'win32')),
			posix: placeholders.map(name => expandShellToolName(name, 'linux')),
		}, {
			win32: ['powershell', 'read_powershell', 'write_powershell', 'stop_powershell', 'list_powershell', 'powershell_shutdown'],
			posix: ['bash', 'read_bash', 'write_bash', 'stop_bash', 'list_bash', 'bash_shutdown'],
		});
	});

	test('names that do not vary by platform are left alone', () => {
		const untouched = ['Bash', 'shell', 'Read', 'view', 'create', 'str_replace_editor'];
		assert.deepStrictEqual({
			normalized: untouched.map(normalizeShellToolNameForCapture),
			expanded: untouched.map(name => expandShellToolName(name, 'win32')),
		}, {
			normalized: untouched,
			expanded: untouched,
		});
	});
});
