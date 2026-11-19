/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { findPosixOnlyCommands, getRecordedShellCommand, type IRecordedCommand } from './e2e/harness/posixCommandLint.js';

function check(commands: readonly string[]): string[] {
	const recorded: IRecordedCommand[] = commands.map(command => ({ command, toolName: 'bash' }));
	return findPosixOnlyCommands(recorded).map(finding => finding.command);
}

suite('posixCommandLint', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('flags the POSIX commands models actually reach for', () => {
		const flagged = [
			`wc -l < lines.txt`,
			`printf '%s\\n' "SHELL_VALUE_73"`,
			`ls -1`,
			`ls -la \${workdir}/`,
			`rm \${workdir}/before.txt`,
			`mv before.txt after.txt && ls -la after.txt`,
			`cat missing.txt 2>&1`,
			`mkdir -p output && printf 'NESTED' > output/report.txt`,
			`find / -maxdepth 6 -iname "edit.txt" 2>/dev/null`,
			`xxd \${workdir}/after.txt`,
			`test -f peer-edit.txt && echo EXISTS || echo MISSING`,
			`echo "$HOME"`,
		];
		assert.deepStrictEqual(check(flagged), flagged);
	});

	test('extracts provider shell command fields', () => {
		assert.deepStrictEqual([
			getRecordedShellCommand({ command: 'cat command.txt' }),
			getRecordedShellCommand({ cmd: 'cat cmd.txt' }),
			getRecordedShellCommand({ command: 1, cmd: 'cat fallback.txt' }),
			getRecordedShellCommand(undefined),
		], [
			'cat command.txt',
			'cat cmd.txt',
			'cat fallback.txt',
			undefined,
		]);
	});

	test('accepts the portable forms the suite standardizes on', () => {
		assert.deepStrictEqual(check([
			`echo SHELL_VALUE_73`,
			`echo "hello from test"`,
			`git status --porcelain`,
			`node -e "console.log(process.cwd())"`,
			`node -e "require('fs').renameSync('before.txt','after.txt')"`,
			`node -e "require('fs').unlinkSync('delete-me.txt')"`,
			`node -e "console.log(require('fs').readdirSync('.').join(' '))"`,
			`node -e "const fs=require('fs');fs.mkdirSync('output',{recursive:true});fs.writeFileSync('output/report.txt','X')"`,
			`node script.js`,
			`pwd`,
		]), []);
	});

	test('does not flag POSIX command names appearing as arguments', () => {
		assert.deepStrictEqual(check([
			`node -e "console.log('ls')"`,
			`echo cat`,
			`node -e "require('fs').writeFileSync('rm.txt','x')"`,
			`node -e "console.log(require('fs').readdirSync('.'))"`,
			`git status --find-renames`,
		]), []);
	});

	test('ignores recorder placeholders that look like variable expansions', () => {
		assert.deepStrictEqual(check([
			`node -e "console.log(1)" \${workdir}`,
			`echo \${homedir}`,
			`node script.js \${temp}`,
		]), []);
	});

	test('reports the reason and tool for each finding', () => {
		assert.deepStrictEqual(findPosixOnlyCommands([
			{ command: `wc -l lines.txt`, toolName: 'bash' },
			{ command: `echo ok`, toolName: 'bash' },
			{ command: `cat x 2>/dev/null`, toolName: 'powershell' },
		]), [
			{ command: `wc -l lines.txt`, toolName: 'bash', reason: 'uses a POSIX coreutil or shell builtin that is not portable to Windows shells' },
			{ command: `cat x 2>/dev/null`, toolName: 'powershell', reason: 'uses a POSIX coreutil or shell builtin that is not portable to Windows shells' },
		]);
	});
});
